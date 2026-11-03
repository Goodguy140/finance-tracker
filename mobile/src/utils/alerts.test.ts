import { describe, expect, it } from 'vitest';

import { apnsEnvironment, registrationBody, routeForAlert } from './alerts';

describe('routeForAlert', () => {
  it('opens the screen each kind of alert is about', () => {
    expect(routeForAlert({ kind: 'billReminders', url: '/' })).toBe('/bills');
    expect(routeForAlert({ kind: 'chargeAlerts' })).toBe('/transactions');
    expect(routeForAlert({ kind: 'budgetAlerts' })).toBe('/budgets');
    expect(routeForAlert({ kind: 'test' })).toBe('/');
  });

  it('opens nothing for an alert it does not know', () => {
    expect(routeForAlert({ kind: 'somethingNew' })).toBeNull();
    expect(routeForAlert(null)).toBeNull();
    expect(routeForAlert('billReminders')).toBeNull();
  });
});

it('registers TestFlight builds with production push and dev builds with the sandbox', () => {
  expect(apnsEnvironment(false)).toBe('production');
  expect(apnsEnvironment(true)).toBe('development');
});

it('sends only the switch that changed, with the token every time', () => {
  expect(registrationBody('ab', 'production', { alerts: { chargeAlerts: false } })).toEqual({
    token: 'ab',
    environment: 'production',
    alerts: { chargeAlerts: false },
  });
  expect(registrationBody('ab', 'production')).toEqual({ token: 'ab', environment: 'production' });
});
