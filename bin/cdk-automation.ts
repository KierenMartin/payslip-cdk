#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { CdkAutomationStack } from '../lib/cdk-automation-stack';
const app = new cdk.App();
new CdkAutomationStack(app, 'CdkAutomationStack');
