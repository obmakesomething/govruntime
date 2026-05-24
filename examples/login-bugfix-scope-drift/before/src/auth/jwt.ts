export function getJWTOptions() {
  return {
    expiresIn: "600s", // 10 minutes - user requested 1 hour (3600s)
    issuer: "auth-service"
  };
}
