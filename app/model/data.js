// The Disruption desk's start data: fictional airline ZX, local departure and arrival times (no time zones). Every page
// load starts from here. Part 1: 1–3 Nov 2026, ZX 400 FRA→JFK cancelled. Scenario 2: 9–11 Nov, ZX 440 and ZX 444
// cancelled, with connections via other airports. Passenger IDs are opaque; flightIds are the flights booked, in order.
sap.ui.define([], () => {
  'use strict'
  const flight = (number, from, to, departs, arrives, status, economy, business) =>
    ({ id: number.replace(' ', ''), number, from, to, departs, arrives, status, free: { Economy: economy, Business: business } })
  const passenger = (id, name, booking, cabin, flightId) => ({ id, name, booking, cabin, flightIds: [flightId] })

  return {
    flights: [
      flight('ZX 400', 'FRA', 'JFK', '2026-11-02T10:00', '2026-11-02T12:45', 'Cancelled', 0, 0),
      flight('ZX 402', 'FRA', 'JFK', '2026-11-02T18:00', '2026-11-02T20:45', 'Scheduled', 2, 1),
      flight('ZX 404', 'FRA', 'JFK', '2026-11-03T07:00', '2026-11-03T09:45', 'Scheduled', 3, 0),
      flight('ZX 406', 'FRA', 'JFK', '2026-11-03T10:00', '2026-11-03T12:45', 'Scheduled', 6, 4),
      flight('ZX 401', 'JFK', 'FRA', '2026-11-01T22:00', '2026-11-02T12:00', 'Scheduled', 7, 3),
      flight('ZX 403', 'JFK', 'FRA', '2026-11-02T22:00', '2026-11-03T12:00', 'Scheduled', 1, 0),
      flight('ZX 410', 'FRA', 'LHR', '2026-11-01T08:00', '2026-11-01T08:45', 'Scheduled', 12, 4),
      flight('ZX 412', 'FRA', 'LHR', '2026-11-02T12:00', '2026-11-02T12:45', 'Scheduled', 5, 2),
      flight('ZX 418', 'MUC', 'JFK', '2026-11-01T15:00', '2026-11-01T18:00', 'Scheduled', 4, 2),
      flight('ZX 420', 'MUC', 'JFK', '2026-11-02T09:00', '2026-11-02T12:00', 'Scheduled', 9, 6),
      flight('ZX 422', 'MUC', 'JFK', '2026-11-03T11:00', '2026-11-03T14:00', 'Scheduled', 3, 1),
      flight('ZX 424', 'MUC', 'JFK', '2026-11-02T08:00', '2026-11-02T11:00', 'Cancelled', 0, 0),
      flight('ZX 440', 'FRA', 'JFK', '2026-11-09T10:00', '2026-11-09T12:45', 'Cancelled', 0, 0),
      flight('ZX 444', 'MUC', 'JFK', '2026-11-09T09:30', '2026-11-09T12:30', 'Cancelled', 0, 0),
      flight('ZX 446', 'FRA', 'JFK', '2026-11-09T18:00', '2026-11-09T20:45', 'Scheduled', 1, 0),
      flight('ZX 448', 'FRA', 'JFK', '2026-11-10T10:00', '2026-11-10T12:45', 'Scheduled', 0, 0),
      flight('ZX 449', 'FRA', 'JFK', '2026-11-11T10:00', '2026-11-11T12:45', 'Scheduled', 3, 1),
      flight('ZX 445', 'MUC', 'JFK', '2026-11-10T09:30', '2026-11-10T12:30', 'Scheduled', 0, 1),
      flight('ZX 450', 'FRA', 'LHR', '2026-11-09T12:00', '2026-11-09T12:45', 'Scheduled', 8, 4),
      flight('ZX 456', 'FRA', 'LHR', '2026-11-10T07:00', '2026-11-10T07:45', 'Scheduled', 6, 2),
      flight('ZX 454', 'MUC', 'LHR', '2026-11-09T11:00', '2026-11-09T12:10', 'Scheduled', 5, 2),
      flight('ZX 460', 'LHR', 'JFK', '2026-11-09T15:00', '2026-11-09T17:55', 'Scheduled', 3, 0),
      flight('ZX 462', 'LHR', 'JFK', '2026-11-09T19:00', '2026-11-09T21:55', 'Scheduled', 3, 1),
      flight('ZX 464', 'LHR', 'JFK', '2026-11-10T10:00', '2026-11-10T12:55', 'Scheduled', 3, 2),
      flight('ZX 470', 'FRA', 'AMS', '2026-11-09T13:00', '2026-11-09T14:10', 'Scheduled', 5, 2),
      flight('ZX 474', 'MUC', 'AMS', '2026-11-09T11:30', '2026-11-09T13:05', 'Scheduled', 4, 2),
      flight('ZX 472', 'AMS', 'JFK', '2026-11-09T16:30', '2026-11-09T18:40', 'Scheduled', 4, 2),
      flight('ZX 480', 'FRA', 'DUB', '2026-11-09T11:30', '2026-11-09T12:50', 'Scheduled', 3, 2),
      flight('ZX 482', 'DUB', 'BOS', '2026-11-09T15:00', '2026-11-09T17:10', 'Scheduled', 3, 2),
      flight('ZX 486', 'FRA', 'KEF', '2026-11-09T13:00', '2026-11-09T15:40', 'Scheduled', 0, 2),
      flight('ZX 488', 'KEF', 'JFK', '2026-11-09T17:30', '2026-11-09T19:10', 'Scheduled', 4, 0),
      flight('ZX 494', 'FRA', 'BOS', '2026-11-09T13:30', '2026-11-09T16:10', 'Scheduled', 4, 3),
      flight('ZX 490', 'BOS', 'JFK', '2026-11-09T19:00', '2026-11-09T20:25', 'Scheduled', 2, 2),
      flight('ZX 492', 'BOS', 'JFK', '2026-11-09T21:30', '2026-11-09T22:55', 'Scheduled', 3, 0)
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
      passenger('j2s7gn', 'Lea Weber', 'WB6H2K', 'Economy', 'ZX424'),
      passenger('h7c2nv', 'Greta Weiss', 'WN4R8C', 'Business', 'ZX440'),
      passenger('t4q9mx', 'Paul Weiss', 'WN4R8C', 'Economy', 'ZX440'),
      passenger('z1r6bd', 'Nina Weiss', 'WN4R8C', 'Economy', 'ZX440'),
      passenger('e8w3ks', 'Henrik Lund', 'LM2Q7H', 'Business', 'ZX440'),
      passenger('n5y7fa', 'Ingrid Lund', 'LM2Q7H', 'Business', 'ZX440'),
      passenger('u2j8lc', 'Piotr Dabrowski', 'PD9X3K', 'Economy', 'ZX440'),
      passenger('a6m1qr', 'Ewa Dabrowska', 'PD9X3K', 'Economy', 'ZX440'),
      passenger('x9d4wg', 'Kasia Dabrowska', 'PD9X3K', 'Economy', 'ZX440'),
      passenger('s3v5pe', 'Jakub Dabrowski', 'PD9X3K', 'Economy', 'ZX440'),
      passenger('g7k2zt', 'Sofia Vidal', 'SV5J1N', 'Economy', 'ZX440'),
      passenger('d1x8hn', 'Teo Costa', 'CB8T4F', 'Economy', 'ZX440'),
      passenger('p4f6ry', 'Bia Costa', 'CB8T4F', 'Economy', 'ZX440'),
      passenger('v9a3mc', 'Hugo Brandt', 'HB3K9W', 'Business', 'ZX444'),
      passenger('k2n7ue', 'Mila Brandt', 'HB3K9W', 'Economy', 'ZX444'),
      passenger('b5t1xw', 'Omar Rahimi', 'OR6M2D', 'Economy', 'ZX444'),
      passenger('m8g4jd', 'Leila Rahimi', 'OR6M2D', 'Economy', 'ZX444'),
      passenger('r3e9vk', 'Sami Rahimi', 'OR6M2D', 'Economy', 'ZX444'),
      passenger('f6p2ql', 'Erik Kask', 'EK1V7P', 'Business', 'ZX444')
    ]
  }
})
