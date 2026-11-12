#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
set -euo pipefail

subscription="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the target subscription}"
group="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to an existing resource group}"
workspace="/subscriptions/$subscription/resourceGroups/$group/providers/Microsoft.OperationalInsights/workspaces/ms-events-guide-logs"
az rest --subscription "$subscription" --method get \
  --url "https://management.azure.com$workspace/tables/AppEvents?api-version=2022-10-01" \
  --query '{name:name,analyticsDays:properties.retentionInDays,totalDays:properties.totalRetentionInDays}' --output json
az rest --subscription "$subscription" --method patch \
  --url "https://management.azure.com$workspace/tables/AppEvents?api-version=2022-10-01" \
  --body '{"properties":{"retentionInDays":730,"totalRetentionInDays":730}}' --output none
az rest --subscription "$subscription" --method get \
  --url "https://management.azure.com$workspace/tables/AppEvents?api-version=2022-10-01" \
  --query '{name:name,analyticsDays:properties.retentionInDays,totalDays:properties.totalRetentionInDays}' --output json
