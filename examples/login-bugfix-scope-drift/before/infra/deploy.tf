resource "kubernetes_deployment" "auth" {
  metadata {
    name = "auth-service"
  }
  spec {
    replicas = 2 # Agent will attempt to increase this to 4 (unauthorized)
  }
}
