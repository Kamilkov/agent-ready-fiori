// The Disruption desk's start data: fictional airline ZX, 1–3 Nov 2026, local departure times. Every page load starts
// from here. The FRA→JFK flights and ZX 400's passengers are the benchmark's core data; passenger IDs are opaque.
sap.ui.define([], () => {
  'use strict'
  const flight = (number, from, to, departs, status, economy, business) =>
    ({ id: number.replace(' ', ''), number, from, to, departs, status, free: { Economy: economy, Business: business } })
  const passenger = (id, name, booking, cabin, flightId) => ({ id, name, booking, cabin, flightId })

  return {
    flights: [
      flight('ZX 400', 'FRA', 'JFK', '2026-11-02T10:00', 'Cancelled', 0, 0),
      flight('ZX 402', 'FRA', 'JFK', '2026-11-02T18:00', 'Scheduled', 2, 1),
      flight('ZX 404', 'FRA', 'JFK', '2026-11-03T07:00', 'Scheduled', 3, 0),
      flight('ZX 406', 'FRA', 'JFK', '2026-11-03T10:00', 'Scheduled', 6, 4),
      flight('ZX 401', 'JFK', 'FRA', '2026-11-01T22:00', 'Scheduled', 7, 3),
      flight('ZX 403', 'JFK', 'FRA', '2026-11-02T22:00', 'Scheduled', 1, 0),
      flight('ZX 410', 'FRA', 'LHR', '2026-11-01T08:00', 'Scheduled', 12, 4),
      flight('ZX 412', 'FRA', 'LHR', '2026-11-02T12:00', 'Scheduled', 5, 2),
      flight('ZX 418', 'MUC', 'JFK', '2026-11-01T15:00', 'Scheduled', 4, 2),
      flight('ZX 420', 'MUC', 'JFK', '2026-11-02T09:00', 'Scheduled', 9, 6),
      flight('ZX 422', 'MUC', 'JFK', '2026-11-03T11:00', 'Scheduled', 3, 1),
      flight('ZX 424', 'MUC', 'JFK', '2026-11-02T08:00', 'Cancelled', 0, 0)
    ],
    passengers: [
      passenger('c4m8pz', 'Jan Horvat', 'HZ4K7Q', 'Economy', 'ZX400'),
      passenger('r2x7kd', 'Maja Horvat', 'HZ4K7Q', 'Economy', 'ZX400'),
      passenger('w9t3fq', 'Luka Horvat', 'HZ4K7Q', 'Economy', 'ZX400'),
      passenger('b6n1vj', 'Elena Rossi', 'RS2M9D', 'Business', 'ZX400'),
      passenger('y3h5sl', 'Marco Rossi', 'RS2M9D', 'Business', 'ZX400'),
      passenger('q7d2ax', 'Anna Novak', 'NV8P2L', 'Economy', 'ZX400'),
      passenger('f5k9re', 'Tom Berger', 'BG5J3R', 'Economy', 'ZX400'),
      passenger('m1z6wu', 'Sara Lind', 'LD9C6W', 'Business', 'ZX400'),
      passenger('k8p4ty', 'Ivo Petrov', 'PT3F8N', 'Economy', 'ZX424'),
      passenger('j2s7gn', 'Lea Weber', 'WB6H2K', 'Economy', 'ZX424')
    ]
  }
})
