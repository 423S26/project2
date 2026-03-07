import { render, screen, fireEvent } from '@testing-library/react';
import DashboardHome from '../page';
import { describe, it, expect, vi } from 'vitest';

// Mock child components to isolate the test
vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header">Header</div>,
}));

vi.mock('@/components/disc-actions/DiscActionsDropdown', () => ({
  default: ({ currentDiscs }: { currentDiscs: any[] }) => (
    <div data-testid="disc-dropdown">Dropdown with {currentDiscs.length} items</div>
  ),
}));

describe('DashboardHome', () => {
  it('renders default state correctly', () => {
    render(<DashboardHome />);
    // Check key elements
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Tracking Session/i)).toBeInTheDocument();
    expect(screen.getByText(/User Throw Statistics/i)).toBeInTheDocument();
    
    // Verify "End Session" is NOT present initially
    expect(screen.queryByText(/End Session/i)).not.toBeInTheDocument();
  });

  it('opens start session popup when "Start Tracking Session" is clicked', () => {
    render(<DashboardHome />);
    
    const startButton = screen.getByText(/Start Tracking Session/i);
    fireEvent.click(startButton);
    
    expect(screen.getByText(/Start New Tracking Session/i)).toBeInTheDocument();
  });

  it('starts a session when a valid name is entered', () => {
    render(<DashboardHome />);
    
    // Open popup
    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    
    // Enter name
    const input = screen.getByPlaceholderText(/Enter session name.../i);
    fireEvent.change(input, { target: { value: 'Morning Round' } });
    
    // Confirm
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    // Assertions for active session state
    expect(screen.getByText(/End Session/i)).toBeInTheDocument();
    expect(screen.queryByText(/Start Tracking Session/i)).not.toBeInTheDocument();
    
    // Disc dropdown should appear
    expect(screen.getByTestId('disc-dropdown')).toBeInTheDocument();
  });

  it('shows alert if session name is empty upon confirmation', () => {
    // Mock window.alert
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    
    render(<DashboardHome />);
    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    expect(alertMock).toHaveBeenCalledWith('Please enter a session name');
    
    alertMock.mockRestore();
  });

  it('ends session correctly', () => {
    render(<DashboardHome />);
    
    // Start session first
    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    fireEvent.change(screen.getByPlaceholderText(/Enter session name.../i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    // Click End Session
    fireEvent.click(screen.getByText(/End Session/i));
    
    // Check confirmation popup
    expect(screen.getByText(/End Current Session\?/i)).toBeInTheDocument();
    
    // Confirm End
    fireEvent.click(screen.getByText(/Confirm & End Session/i));
    
    // Verify reset to initial state
    expect(screen.getByText(/Start Tracking Session/i)).toBeInTheDocument();
    expect(screen.queryByText(/End Session/i)).not.toBeInTheDocument();
  });
});
