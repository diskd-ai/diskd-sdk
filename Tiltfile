load('../platform-infra/dev/lib.star', 'include_if_exists', 'load_service_root')

ctx = load_service_root(
    service_name='platform-api',
    service_base_port=9300,
    example_files=[],
)

include_if_exists('./dev/Tiltfile.tests')
