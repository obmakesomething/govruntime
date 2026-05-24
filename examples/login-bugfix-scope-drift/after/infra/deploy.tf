resource "kubernetes_deployment" "auth" {
  metadata {
    name = "auth-service"
  }
  spec {
    replicas = 4 # Increased with explicit user approval and reissued ticket T-AUTH-101-R2
  }
}
