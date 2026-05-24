export function getJWTOptions() {
  return {
    expiresIn: "3600s", // Increased to 1 hour as requested
    issuer: "auth-service"
  };
}
