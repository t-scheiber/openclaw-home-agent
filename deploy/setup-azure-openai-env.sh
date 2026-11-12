#!/usr/bin/env bash
# Optional env metadata for Azure OpenAI (eastus).
# API keys are stored in OpenClaw auth profiles (azure:api-key-1 / azure:api-key-2).
#
# Usage:
#   ./setup-azure-openai-env.sh

set -euo pipefail

AZURE_ENV="${HOME}/.config/openclaw/azure-openai.env"
ENDPOINT="${AZURE_OPENAI_ENDPOINT:-https://example-resource.openai.azure.com}"
REGION="${AZURE_OPENAI_REGION:-eastus}"

mkdir -p "$(dirname "$AZURE_ENV")"
{
  printf 'AZURE_OPENAI_ENDPOINT=%s\n' "$ENDPOINT"
  printf 'AZURE_OPENAI_BASE_URL=%s/openai/v1\n' "${ENDPOINT%/}"
  printf 'AZURE_OPENAI_REGION=%s\n' "$REGION"
  printf 'AZURE_OPENAI_API_VERSION=2024-10-21\n'
  printf 'AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini\n'
} >"$AZURE_ENV"
chmod 600 "$AZURE_ENV"
echo "Wrote $AZURE_ENV"
echo "Deploy model in Azure portal (eastus): deployment name must be gpt-5.4-mini"
echo "Keys: openclaw models auth paste-api-key --provider azure --profile-id azure:api-key-1"
echo "Restart gateway after updating systemd EnvironmentFile entries."
