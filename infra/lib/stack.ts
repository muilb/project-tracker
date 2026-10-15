import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface TrackerStackProps extends StackProps {
  /** Roles granted on first login: `email` (PMO) or `email:ROLE`. */
  adminEmails: string[];
}

export class TrackerStack extends Stack {
  constructor(scope: Construct, id: string, props: TrackerStackProps) {
    super(scope, id, props);

    // --- Data ---
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl', // expires alert de-duplication rows
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // --- Login (Cognito only authenticates; roles live in DynamoDB) ---
    const userPool = new cognito.UserPool(this, 'Users', {
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
      passwordPolicy: { minLength: 8, requireLowercase: true, requireDigits: true, requireUppercase: false, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const webClient = userPool.addClient('Web', {
      authFlows: { userSrp: true, userPassword: true },
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    // --- Web hosting (React SPA from web/dist) ---
    const site = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    const webUrl = `https://${cdn.distributionDomainName}`;

    // --- Lambdas ---
    const lambdaProps = (name: string, entry: string, timeoutSeconds: number) => ({
      entry: path.join(root, entry),
      depsLockFilePath: path.join(root, 'package-lock.json'),
      runtime: Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(timeoutSeconds),
      logGroup: new LogGroup(this, `${name}Logs`, { retention: RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      environment: {
        TABLE_NAME: table.tableName,
        ADMIN_EMAILS: props.adminEmails.join(','),
        WEB_URL: webUrl,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });

    const apiFn = new NodejsFunction(this, 'ApiFn', lambdaProps('Api', 'api/src/lambda.ts', 29));
    table.grantReadWriteData(apiFn);
    // PMO / MNG approve sign-ups whose confirmation email never arrived.
    apiFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
    userPool.grant(
      apiFn,
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminConfirmSignUp',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminDeleteUser',
    );

    // Hourly Teams alerts + 08:00 digest (the job itself checks Vietnam time).
    const cronFn = new NodejsFunction(this, 'CronFn', lambdaProps('Cron', 'api/src/cron.ts', 120));
    table.grantReadWriteData(cronFn);
    new events.Rule(this, 'Hourly', {
      schedule: events.Schedule.cron({ minute: '5' }),
      targets: [new targets.LambdaFunction(cronFn, { retryAttempts: 0 })],
    });


    const api = new apigw.HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        maxAge: Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    const authorizer = new HttpUserPoolAuthorizer('Cognito', userPool, { userPoolClients: [webClient] });
    // Explicit methods (not ANY) so CORS preflight OPTIONS is answered by API Gateway without auth.
    const { GET, POST, PATCH, PUT, DELETE } = apigw.HttpMethod;
    api.addRoutes({ path: '/{proxy+}', methods: [GET, POST, PATCH, PUT, DELETE], integration, authorizer });
    api.addRoutes({ path: '/public', methods: [GET], integration });
    api.addRoutes({ path: '/health', methods: [GET], integration });
    // Cap traffic (the public dashboard is open to the internet).
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 50 };

    const webDist = path.join(root, 'web/dist');
    new s3deploy.BucketDeployment(this, 'WebDeploy', {
      destinationBucket: site,
      distribution: cdn,
      sources: [
        ...(existsSync(webDist) ? [s3deploy.Source.asset(webDist)] : []),
        // Runtime config read by the web app, so the build does not depend on stack outputs.
        s3deploy.Source.jsonData('config.json', {
          apiUrl: api.apiEndpoint,
          region: this.region,
          userPoolId: userPool.userPoolId,
          userPoolClientId: webClient.userPoolClientId,
        }),
      ],
    });

    new CfnOutput(this, 'WebUrl', { value: webUrl });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
