import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
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
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { contentSecurityPolicy, HSTS_SECONDS, PERMISSIONS_POLICY } from './headers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface TrackerStackProps extends StackProps {
  /** Roles granted on first login: `email` (PMO) or `email:ROLE`. */
  adminEmails: string[];
  /** Also receive the CloudWatch alarms by email (SNS; each address confirms once). */
  alarmEmails?: string[];
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
      // Read by row kind (snapshot, users, channels) instead of scanning inbox / log rows too.
      globalSecondaryIndexes: [
        {
          indexName: 'byKind',
          partitionKey: { name: 'kind', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        },
      ],
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
    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(site);

    // Created before the CDN: the web's Content-Security-Policy names its address (routes are added below).
    const api = new apigw.HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        maxAge: Duration.hours(1),
      },
    });
    // Security headers on every web response (lib/headers.ts; the e2e tests serve the same ones).
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'WebHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: contentSecurityPolicy([api.apiEndpoint, `https://cognito-idp.${this.region}.amazonaws.com`]),
          override: true,
        },
        strictTransportSecurity: { accessControlMaxAge: Duration.seconds(HSTS_SECONDS), includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      },
      customHeadersBehavior: { customHeaders: [{ header: 'Permissions-Policy', value: PERMISSIONS_POLICY, override: true }] },
    });
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy,
      },
      // The Web Push service worker is never cached at the edge, so a new version reaches browsers
      // on their next update check (the page registers it with updateViaCache: 'none').
      additionalBehaviors: {
        '/sw.js': {
          origin: siteOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          responseHeadersPolicy,
        },
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
    // PMO / MNG approve sign-ups whose confirmation email never arrived, and hand out temporary passwords.
    apiFn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
    userPool.grant(
      apiFn,
      'cognito-idp:ListUsers',
      'cognito-idp:AdminGetUser',
      'cognito-idp:AdminConfirmSignUp',
      'cognito-idp:AdminUpdateUserAttributes',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminSetUserPassword',
    );

    // Hourly Teams alerts + 08:00 digest (the job itself checks Vietnam time).
    const cronFn = new NodejsFunction(this, 'CronFn', lambdaProps('Cron', 'api/src/cron.ts', 120));
    table.grantReadWriteData(cronFn);
    new events.Rule(this, 'Hourly', {
      schedule: events.Schedule.cron({ minute: '5' }),
      targets: [new targets.LambdaFunction(cronFn, { retryAttempts: 0 })],
    });
    // Every minute: messages waiting in the outbox (delayed, grouped or retried alerts).
    const flushFn = new NodejsFunction(this, 'FlushFn', { ...lambdaProps('Flush', 'api/src/cron.ts', 50), handler: 'flush' });
    table.grantReadWriteData(flushFn);
    new events.Rule(this, 'EveryMinute', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(flushFn, { retryAttempts: 0 })],
    });

    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    const authorizer = new HttpUserPoolAuthorizer('Cognito', userPool, { userPoolClients: [webClient] });
    // Explicit methods (not ANY) so CORS preflight OPTIONS is answered by API Gateway without auth.
    const { GET, POST, PATCH, PUT, DELETE } = apigw.HttpMethod;
    api.addRoutes({ path: '/{proxy+}', methods: [GET, POST, PATCH, PUT, DELETE], integration, authorizer });
    api.addRoutes({ path: '/public', methods: [GET], integration });
    api.addRoutes({ path: '/health', methods: [GET], integration });
    // Telegram updates: no Cognito login, the Lambda checks the webhook's secret token.
    api.addRoutes({ path: '/telegram/webhook', methods: [POST], integration });
    // Cap traffic (the public dashboard is open to the internet).
    const stage = api.defaultStage!.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 50 };

    // --- Alarms: system administrators (inbox / Telegram / Web Push) and ALARM_EMAILS ---
    const alarmTopic = new sns.Topic(this, 'Alarms', { displayName: 'project-tracker alarms' });
    for (const email of props.alarmEmails ?? []) alarmTopic.addSubscription(new subscriptions.EmailSubscription(email));
    const alarmFn = new NodejsFunction(this, 'AlarmFn', { ...lambdaProps('Alarm', 'api/src/cron.ts', 30), handler: 'alarm' });
    table.grantReadWriteData(alarmFn);
    alarmTopic.addSubscription(new subscriptions.LambdaSubscription(alarmFn));
    const period = Duration.minutes(5);
    const { GET_ITEM, PUT_ITEM, UPDATE_ITEM, DELETE_ITEM, QUERY, SCAN } = dynamodb.Operation;
    const operations = [GET_ITEM, PUT_ITEM, UPDATE_ITEM, DELETE_ITEM, QUERY, SCAN]; // the ones the API uses
    // The description is the key of the message in api/src/notify/alarms.ts.
    const alarms: [key: string, metric: cloudwatch.IMetric, threshold: number][] = [
      ['api-5xx', api.metricServerError({ period, statistic: 'Sum' }), 5],
      ['api-errors', apiFn.metricErrors({ period }), 1],
      ['api-throttles', apiFn.metricThrottles({ period }), 1],
      ['cron-errors', cronFn.metricErrors({ period: Duration.hours(1) }), 1],
      // Every minute: a few failures in 5 minutes, not a single blip.
      ['flush-errors', flushFn.metricErrors({ period }), 3],
      ['table-throttles', table.metricThrottledRequestsForOperations({ period, operations }), 1],
      ['table-errors', table.metricSystemErrorsForOperations({ period, operations }), 1],
    ];
    for (const [key, metric, threshold] of alarms) {
      const alarm = new cloudwatch.Alarm(this, `Alarm-${key}`, {
        alarmDescription: key,
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new SnsAction(alarmTopic));
      alarm.addOkAction(new SnsAction(alarmTopic));
    }
    // AlarmFn's own failures reach ALARM_EMAILS only.
    const alarmFnErrors = new cloudwatch.Alarm(this, 'Alarm-alarm-errors', {
      alarmDescription: 'alarm-errors',
      metric: alarmFn.metricErrors({ period }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alarmFnErrors.addAlarmAction(new SnsAction(alarmTopic));

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
