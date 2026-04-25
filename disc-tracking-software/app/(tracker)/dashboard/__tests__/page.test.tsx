/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardHome from '../page';
import { describe, it, expect, vi } from 'vitest';
import { DeviceProvider } from '@/contexts/DeviceContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { act } from 'react';
import * as toastModule from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mockDeviceContext = {
  connectedDevice: { deviceId: 'test-device-id' },
  connectDevice: vi.fn(),
  disconnectDevice: vi.fn(),
};

vi.mock('@/contexts/DeviceContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/DeviceContext')>();
  return {
    ...actual,
    useDevice: () => mockDeviceContext,
  };
});

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header">Header</div>,
}));

vi.mock('@/lib/api-client', () => ({
  sessionAPI: {
    createSession: vi.fn().mockResolvedValue({ id: 'test-session-id', device_id: 'test-device-id' }),
    endSession: vi.fn().mockResolvedValue({ id: 'test-session-id' }),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    getUserDiscs: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/components/disc-actions/DiscActionsDropdown', () => ({
  default: ({ currentDiscs }: { currentDiscs: unknown[] }) => (
    <div data-testid="disc-dropdown">Dropdown with {currentDiscs.length} items</div>
  ),
}));

vi.mock('@/lib/actions/auth-actions', () => ({
  getUserNameAction: vi.fn().mockResolvedValue('Test User'),
}));

describe('DashboardHome', () => {
  it('renders default state correctly', () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <DashboardHome />
        </DeviceProvider>
      </SettingsProvider>
    );

    expect(screen.getByText(/Welcome back/i)).not.toBeNull();
    expect(screen.getByText(/Start Tracking Session/i)).not.toBeNull();
    expect(screen.getByText(/User Throw Statistics/i)).not.toBeNull();
    expect(screen.queryByText(/End Session/i)).toBeNull();
  });

  it('opens start session popup when "Start Tracking Session" is clicked', () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <DashboardHome />
        </DeviceProvider>
      </SettingsProvider>
    );
    
    const startButton = screen.getByText(/Start Tracking Session/i);
    act(() => {
      fireEvent.click(startButton);
    });
    
    expect(screen.getByText(/Start New Tracking Session/i)).not.toBeNull();
  });

  it('starts a session when a valid name is entered', async () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <DashboardHome />
        </DeviceProvider>
      </SettingsProvider>
    );
    
    act(() => {
      fireEvent.click(screen.getByText(/Start Tracking Session/i));
    });
    
    const input = screen.getByPlaceholderText(/Enter session name.../i);
    act(() => {
      fireEvent.change(input, { target: { value: 'Morning Round' } });
    });
    act(() => {
      fireEvent.click(screen.getByText(/Confirm & Start/i));
    });
    
    await waitFor(() => {
      expect(screen.getByText(/End Session/i)).not.toBeNull();
    });
    expect(screen.queryByText(/Start Tracking Session/i)).toBeNull();
    expect(screen.getByTestId('disc-dropdown')).not.toBeNull();
  });

  it('shows alert if session name is empty upon confirmation', async () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <DashboardHome />
        </DeviceProvider>
      </SettingsProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText(/Start Tracking Session/i));
    });
    
    act(() => {
      fireEvent.click(screen.getByText(/Confirm & Start/i));
    });
    
    await waitFor(() => {
      expect(toastModule.toast.error).toHaveBeenCalledWith('Please enter a session name');
    });
  });

  it('ends session correctly', async () => {
    render(
      <SettingsProvider>
        <DeviceProvider>
          <DashboardHome />
        </DeviceProvider>
      </SettingsProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText(/Start Tracking Session/i));
    });
    act(() => {
      fireEvent.change(screen.getByPlaceholderText(/Enter session name.../i), { target: { value: 'Test' } });
    });
    act(() => {
      fireEvent.click(screen.getByText(/Confirm & Start/i));
    });
    
    await waitFor(() => {
      expect(screen.getByText(/End Session/i)).not.toBeNull();
    });

    act(() => {
      fireEvent.click(screen.getByText(/End Session/i));
    });
  
    await waitFor(() => {
      expect(screen.getByText(/End Current Session\?/i)).not.toBeNull();
    });
  
    act(() => {
      fireEvent.click(screen.getByText(/Confirm & End Session/i));
    });
    
    await waitFor(() => {
      expect(screen.getByText(/Start Tracking Session/i)).not.toBeNull();
    });
    expect(screen.queryByText(/End Session/i)).toBeNull();
  });
});
