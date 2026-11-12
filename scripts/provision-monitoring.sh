#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
set -euo pipefail

subscription="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the target subscription}"
tenant="${AZURE_TENANT_ID:?Set AZURE_TENANT_ID to the expected tenant}"
group="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to an existing resource group}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-what-if}"

if [[ "$mode" != "what-if" && "$mode" != "create" ]]; then
  printf 'Usage: bash scripts/provision-monitoring.sh [what-if|create]\n' >&2
  exit 1
fi

actual_tenant="$(az account show --subscription "$subscription" --query tenantId --output tsv)"
if [[ "$actual_tenant" != "$tenant" ]]; then
  printf 'The target subscription is not authenticated in the expected tenant.\n' >&2
  exit 1
fi
for provider in Microsoft.Insights Microsoft.OperationalInsights; do
  state="$(az provider show --subscription "$subscription" --namespace "$provider" --query registrationState --output tsv)"
  if [[ "$state" != "Registered" ]]; then
    printf 'Provider %s needs registration; no subscription-wide changes were made.\n' "$provider" >&2
    exit 1
  fi
done

location="$(az group show --subscription "$subscription" --name "$group" --query location --output tsv)"
current_dcr=""
deleted="$(az monitor log-analytics workspace list-deleted-workspaces --subscription "$subscription" \
  --query "length([?name=='ms-events-guide-logs'])" --output tsv)"
if [[ "$deleted" != "0" ]]; then
  printf 'A soft-deleted workspace uses the requested name; explicit recovery/renaming approval is required.\n' >&2
  exit 1
fi
for pair in "Microsoft.Insights/components:ms-events-guide" "Microsoft.OperationalInsights/workspaces:ms-events-guide-logs"; do
  type="${pair%:*}"
  name="${pair##*:}"
  existing="$(az resource list --subscription "$subscription" --resource-group "$group" \
    --resource-type "$type" --name "$name" --query '[0].tags.application' --output tsv)"
  count="$(az resource list --subscription "$subscription" --resource-group "$group" \
    --resource-type "$type" --name "$name" --query 'length(@)' --output tsv)"
  if [[ "$count" != "0" && "$existing" != "ms-events-guide" ]]; then
    printf 'Resource name %s is already occupied; refusing to adopt it.\n' "$name" >&2
    exit 1
  fi
  if [[ "$type" == "Microsoft.OperationalInsights/workspaces" && "$count" != "0" ]]; then
    current_dcr="$(az resource show --subscription "$subscription" --resource-group "$group" \
      --resource-type "$type" --name "$name" --api-version 2023-09-01 \
      --query properties.defaultDataCollectionRuleResourceId --output tsv)"
  fi
done

az deployment group validate --subscription "$subscription" --resource-group "$group" \
  --mode Incremental --template-file "$root/infra/monitoring.json" \
  --parameters location="$location" defaultDataCollectionRuleResourceId="$current_dcr" --output none
az deployment group what-if --subscription "$subscription" --resource-group "$group" \
  --mode Incremental --template-file "$root/infra/monitoring.json" \
  --parameters location="$location" defaultDataCollectionRuleResourceId="$current_dcr" --no-pretty-print

if [[ "$mode" == "create" ]]; then
  az deployment group create --subscription "$subscription" --resource-group "$group" \
    --name ms-events-guide-monitoring --mode Incremental \
    --template-file "$root/infra/monitoring.json" --parameters location="$location" \
    defaultDataCollectionRuleResourceId="$current_dcr" \
    --query properties.outputs --output json
  printf 'AppEvents must be checked and set to 730 days after its first ingestion.\n'
  printf 'Apply the approved pre-storage privacy transformation with scripts/configure-telemetry-privacy.sh.\n'
fi
