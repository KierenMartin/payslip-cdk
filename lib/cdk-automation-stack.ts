
// From https://medium.com/aws-factory/continuous-delivery-of-a-java-spring-boot-webapp-with-aws-cdk-codepipeline-and-docker-56e045812bd2
// With various edits

import { Stack, StackProps, Construct, SecretValue } from '@aws-cdk/core';
import { Vpc } from '@aws-cdk/aws-ec2';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecspatterns from '@aws-cdk/aws-ecs-patterns';
import * as codebuild from '@aws-cdk/aws-codebuild';
import { ManagedPolicy } from '@aws-cdk/aws-iam';
import { Artifact, Pipeline } from '@aws-cdk/aws-codepipeline';
import { GitHubSourceAction, CodeBuildAction, EcsDeployAction} from '@aws-cdk/aws-codepipeline-actions';
import { PipelineProject, LocalCacheMode } from '@aws-cdk/aws-codebuild';

const repoName = "payslip-app-cdk";

export class CdkAutomationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    var oauthToken = SecretValue.secretsManager('github/oauth/token');

    let sourceOutput: Artifact;
    let buildOutput: Artifact;

    // Create VPC for resources...
    var vpc = new Vpc(this, 'cdk-deployed.vpc', {
      cidr: '10.0.0.0/16',
      maxAzs: 2
    });

    // ECR repository
    const ecrRepository = new ecr.Repository(this, repoName, {
      repositoryName: repoName,
    });

    var pipelineProject = this.createPipelineProject(ecrRepository);
    pipelineProject.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));

    sourceOutput = new Artifact();
    buildOutput = new Artifact();

    var githubSourceAction = this.createGithubSourceAction(sourceOutput, oauthToken);
    var buildAction = this.createBuildAction(pipelineProject, sourceOutput, buildOutput);
    var ecsDeployAction = this.createEcsDeployAction(vpc, ecrRepository, buildOutput, pipelineProject);

    var pipeline = new Pipeline(this, 'my_pipeline_', {
      stages: [
        {
          stageName: 'Source',
          actions: [githubSourceAction]
        },
        {
          stageName: 'Build',
          actions: [buildAction]
        },
        {
          stageName: 'Deploy',
          actions: [ecsDeployAction]
        },
      ],
      pipelineName: "my_pipeline",
    });

  }

  // ----------------------- Some helper methods -----------------------
  /**
   * Create the Pipeline Project with Buildspec and other necessary things...
   */
  private createPipelineProject(ecrRepo: ecr.Repository): codebuild.PipelineProject {
    // Quick note: It's important to make sure that privileged: true is listed below under environment: {...}
    // If it's not there, Docker will complain.
    var pipelineProject = new codebuild.PipelineProject(this, 'my-codepipeline', {
      projectName: "my-codepipeline",
      environment: {
        buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_OPEN_JDK_8,
        privileged: true
      },
      environmentVariables: {
        "ECR_REPO": {
          value: ecrRepo.repositoryUriForTag()
        }
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              "#apt-get update -y",
            ],
            finally: [
              "echo Done installing deps"
            ],
          },
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              '$(aws ecr get-login --no-include-email)',
              'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
              'IMAGE_TAG=${COMMIT_HASH:=latest}'
            ],
          },
          build: {
            commands: [
              'echo Building Docker Image $ECR_REPO:latest',
              'docker build -t $ECR_REPO:latest .',
              'echo Tagging Docker Image $ECR_REPO:latest with $ECR_REPO:$IMAGE_TAG',
              'docker tag $ECR_REPO:latest $ECR_REPO:$IMAGE_TAG',
              'echo Pushing Docker Image to $ECR_REPO:latest and $ECR_REPO:$IMAGE_TAG',
              'docker push $ECR_REPO:latest',
              'docker push $ECR_REPO:$IMAGE_TAG'
            ],
            finally: [
              "echo Done building code"
            ],
          },
          post_build: {
            commands: [
              "echo creating imagedefinitions.json dynamically",
              "printf '[{\"name\":\"" + repoName + "\",\"imageUri\": \"" + ecrRepo.repositoryUriForTag() + ":latest\"}]' > imagedefinitions.json",
              "echo Build completed on `date`"
            ]
          }
        },
        artifacts: {
          files: [
            "imagedefinitions.json"
          ]
        }
      }),
      cache: codebuild.Cache.local(LocalCacheMode.DOCKER_LAYER, LocalCacheMode.CUSTOM)
    });
    return pipelineProject;
  }

  /**
   * creates Github Source
   * @param sourceOutput where to put the clones Repository
   */
  public createGithubSourceAction(sourceOutput: Artifact, oauthToken: SecretValue): GitHubSourceAction {
    return new GitHubSourceAction({
      actionName: 'my_github_source',
      owner: 'KierenMartin',
      repo: 'employee-pay-slip',
      oauthToken: oauthToken,
      output: sourceOutput,
      branch: 'master', // default: 'master', but some repos might be using 'main' nowadays
    });
  }

  /**
   * Creates the BuildAction for Codepipeline build step
   * @param pipelineProject pipelineProject to use 
   * @param sourceActionOutput input to build
   * @param buildOutput where to put the ouput
   */
  public createBuildAction(pipelineProject: codebuild.PipelineProject, sourceActionOutput: Artifact,
    buildOutput: Artifact): CodeBuildAction {
    var buildAction = new CodeBuildAction({
      actionName: 'AppBuild',
      project: pipelineProject,
      input: sourceActionOutput,
      outputs: [buildOutput],
    });
    return buildAction;
  }

  public createEcsDeployAction(vpc: Vpc, ecrRepo: ecr.Repository, buildOutput: Artifact, pipelineProject: PipelineProject): EcsDeployAction {
    return new EcsDeployAction({
      actionName: 'EcsDeployAction',
      service: this.createLoadBalancedFargateService(this, vpc, ecrRepo, pipelineProject).service,
      input: buildOutput,
    })
  };

  createLoadBalancedFargateService(scope: Construct, vpc: Vpc, ecrRepository: ecr.Repository, pipelineProject: PipelineProject) {
    var fargateService = new ecspatterns.ApplicationLoadBalancedFargateService(scope, 'myLbFargateService', {
      vpc: vpc,
      memoryLimitMiB: 512,
      cpu: 256,
      assignPublicIp: true,
      taskImageOptions: {
        containerName: repoName,
        image: ecs.ContainerImage.fromRegistry("okaycloud/dummywebserver:latest"),
        // This dummy image is just here to fill space until we have a compiled image.
        // The only problem is that even after the pipeline builds our new real image, this old dummy image does NOT get removed automatically and may
        // continue to take priority when pinging the load balancer as it has its own task definition. Annoying.
        // You can't leave this image field blank though, and if you set it to reference the image that is going to be created in the future, it will panic.
        // It doesn't seem right that I have to remove this definition later in order to get it working.
        containerPort: 8080,
      },
    });
    fargateService.taskDefinition.executionRole?.addManagedPolicy((ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser')));
    return fargateService;
  }
}
// Oh yes, also, you MUST MANUALLY DELETE the ECR repository manually after removing the CloudFront stack. It will NOT be removed automagically.
// If you try to deploy this CDK a second time without remembering to remove the ECR repo, it will fail and you'll get charged for 2 NAT gateway hours. Again.
// Your task definitions won't be removed either.