# Tiltfile - @diskd/sdk (platform-api)
# SDK test and example runners. No K8s deployments -- all resources are local.
# Requires the 'drive' service group for integration tests and examples.
#
# Usage (standalone):
#   tilt up
#
# Usage (from platform-infra):
#   tilt up -- --only drive,platform-api

_included_from_parent = os.getenv('SERVICE_GROUP', '') != ''

if not _included_from_parent:
    allow_k8s_contexts(['orbstack', 'docker-desktop', 'minikube', 'kind-kind', 'rancher-desktop'])

namespace = os.getenv('SERVICE_NAMESPACE', 'platform-api')
os.putenv('SERVICE_NAMESPACE', namespace)

settings = read_yaml('tilt_config.yaml')
is_local = os.getenv('TILT_ENV', 'local') == 'local'

# Load test and example runners
load_dynamic('./dev/Tiltfile.tests')
