The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template


As per the guide I followed:  
`npm run build` to compile first  
`cdk ls` to get the ID of the coded stack  
`cdk deploy [Stack ID here]` to deploy`  

You can also use `cdk ls -l` to see if the computer can figure out any information about the project. It will also let you know if there are any obvious errors (eg syntax).

NOTE: You MUST have at least 2 AZs when deploying your VPC or else it will throw an error.

also why are NAT gateways so expensive jeez
