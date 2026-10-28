// Documentation cannot grant network permissions. Live case access remains off.
export function caseOperationAccess(operation) {
  if (operation.method !== "GET") {
    return {
      group: "blocked",
      label: "Blocked: only reviewed GET requests may be enabled",
    };
  }
  const description = `${operation.path} ${operation.summary} ${operation.operation?.operationId || ""}`;
  if (
    /reset|revoke|rotate|create|delete|remove|update|generate|token|password|credential|sftp/i.test(
      description,
    )
  ) {
    return {
      group: "blocked",
      label: "Blocked: GET may change state or manage credentials",
    };
  }
  return {
    group: "get",
    label: "GET reference only: not reviewed for live access",
  };
}
