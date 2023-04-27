remote_state {
  backend = "s3"
  config = {
    bucket         = "tube-bookmark-production-terraform-state-bucket"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
  }
}

inputs = {
    region = "ap-northeast-1"
}
