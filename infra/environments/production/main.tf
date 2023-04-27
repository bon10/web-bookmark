terraform {
  backend "s3" {
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "4.64.0"
    }
  }
}

module "s3" {
  source      = "../../modules/s3"
  bucket_name = "production-tube-bookmark-bucket"
  region      = var.region
}

module "cognito" {
  source         = "../../modules/cognito"
  user_pool_name = "production-tube-bookmark-user-pool"
}

# module "dynamodb" {
#   source     = "../../modules/dynamodb"
#   table_name = "production-tube-bookmark-table"
#   hash_key   = "id"
# }

# module "api_gateway" {
#   source          = "../../modules/api_gateway"
#   api_name        = "production-tube-bookmark-api"
#   api_description = "tube-bookmark production API"
# }

# module "lambda" {
#   source               = "../../modules/lambda"
#   lambda_function_name = "production-tube-bookmark-lambda"
# }
