export class ProcessRestartHarness<Persistence, Service> {
  private service: Service;

  constructor(
    readonly persistence: Persistence,
    private readonly createService: (persistence: Persistence) => Service
  ) {
    this.service = createService(persistence);
  }

  current(): Service {
    return this.service;
  }

  restart(): Service {
    this.service = this.createService(this.persistence);
    return this.service;
  }
}
