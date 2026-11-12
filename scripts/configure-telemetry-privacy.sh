#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
set -euo pipefail

subscription="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the target subscription}"
group="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to an existing resource group}"
workspace="/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.OperationalInsights/workspaces/ms-events-guide-logs"
rule="/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.Insights/dataCollectionRules/ms-events-guide-privacy"
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-what-if}"
if [[ "$mode" != "what-if" && "$mode" != "create" ]]; then
  printf 'Usage: bash scripts/configure-telemetry-privacy.sh [what-if|create]\n' >&2
  exit 1
fi

owner="$(az resource show --subscription "$subscription" --ids "$workspace" --api-version 2023-09-01 --query tags.application --output tsv)"
if [[ "$owner" != "ms-events-guide" ]]; then
  printf 'Refusing to attach a transformation to an unrelated workspace.\n' >&2
  exit 1
fi
current="$(az resource show --subscription "$subscription" --ids "$workspace" --api-version 2023-09-01 --query properties.defaultDataCollectionRuleResourceId --output tsv)"
if [[ -n "$current" && "$current" != "$rule" ]]; then
  printf 'The workspace already uses a different transformation; explicit approval is required.\n' >&2
  exit 1
fi
count="$(az resource list --subscription "$subscription" --resource-group "$group" --resource-type Microsoft.Insights/dataCollectionRules --name ms-events-guide-privacy --query 'length(@)' --output tsv)"
if [[ "$count" != "0" ]]; then
  rule_owner="$(az resource show --subscription "$subscription" --ids "$rule" --api-version 2023-03-11 --query tags.application --output tsv)"
  if [[ "$rule_owner" != "ms-events-guide" ]]; then
    printf 'The transformation name belongs to an unrelated resource.\n' >&2
    exit 1
  fi
fi
location="$(az resource show --subscription "$subscription" --ids "$workspace" --api-version 2023-09-01 --query location --output tsv)"
az deployment group validate --subscription "$subscription" --resource-group "$group" \
  --mode Incremental --template-file "$root/infra/privacy-transform.json" \
  --parameters location="$location" workspaceResourceId="$workspace" --output none
az deployment group what-if --subscription "$subscription" --resource-group "$group" \
  --mode Incremental --template-file "$root/infra/privacy-transform.json" \
  --parameters location="$location" workspaceResourceId="$workspace" --no-pretty-print
printf 'Workspace association: %s -> %s\n' "$workspace" "$rule"

if [[ "$mode" == "create" ]]; then
  az deployment group create --subscription "$subscription" --resource-group "$group" \
    --name ms-events-guide-privacy --mode Incremental --template-file "$root/infra/privacy-transform.json" \
    --parameters location="$location" workspaceResourceId="$workspace" --output none
  az rest --subscription "$subscription" --method patch \
    --url "https://management.azure.com$workspace?api-version=2023-09-01" \
    --body "{\"properties\":{\"defaultDataCollectionRuleResourceId\":\"$rule\"}}" --output none
  linked="$(az resource show --subscription "$subscription" --ids "$workspace" --api-version 2023-09-01 --query properties.defaultDataCollectionRuleResourceId --output tsv)"
  if [[ "$linked" != "$rule" ]]; then
    printf 'The expected workspace transformation association was not stored.\n' >&2
    exit 1
  fi
  printf 'Workspace transformation attached. Verify newly ingested rows after propagation.\n'
fi
