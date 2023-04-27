#!/bin/bash

# This script is used to run Terragrunt commands for the specified environment.
# Usage: ./run.sh <command> <environment>
# Example:
#   ./run.sh apply dev
#   ./run.sh init production
#   ./run.sh plan dev

if [ $# -lt 2 ]; then
    echo "Usage: $0 <command> <environment>"
    echo "Example: $0 apply dev"
    exit 1
fi

COMMAND=$1
ENVIRONMENT=$2

if [ "${ENVIRONMENT}" != "dev" ] && [ "${ENVIRONMENT}" != "production" ]; then
    echo "Invalid environment: ${ENVIRONMENT}"
    echo "Please choose either 'dev' or 'production'"
    exit 1
fi

set -a && source .env && set +a && terragrunt ${COMMAND} --terragrunt-working-dir environments/${ENVIRONMENT}
