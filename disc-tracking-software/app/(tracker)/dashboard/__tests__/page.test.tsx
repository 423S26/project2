/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardHome from '../page';
import { describe, it, expect, vi } from 'vitest';

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

    expect(screen.getByText(/Welcome back/i));
    expect(screen.getByText(/Start Tracking Session/i));
    expect(screen.getByText(/User Throw Statistics/i));
    expect(screen.queryByText(/End Session/i)).not;
  });

  it('opens start session popup when "Start Tracking Session" is clicked', () => {
    render(<DashboardHome />);
    
    const startButton = screen.getByText(/Start Tracking Session/i);
    fireEvent.click(startButton);
    
    expect(screen.getByText(/Start New Tracking Session/i));
  });

  it('starts a session when a valid name is entered', () => {
    render(<DashboardHome />);
    
    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    
    const input = screen.getByPlaceholderText(/Enter session name.../i);
    fireEvent.change(input, { target: { value: 'Morning Round' } });
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    expect(screen.getByText(/End Session/i));
    expect(screen.queryByText(/Start Tracking Session/i)).not;
    expect(screen.getByTestId('disc-dropdown'));
  });

  it('shows alert if session name is empty upon confirmation', () => {

    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    
    render(<DashboardHome />);
    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    expect(alertMock).toHaveBeenCalledWith('Please enter a session name');
    
    alertMock.mockRestore();
  });

  it('ends session correctly', () => {
    render(<DashboardHome />);

    fireEvent.click(screen.getByText(/Start Tracking Session/i));
    fireEvent.change(screen.getByPlaceholderText(/Enter session name.../i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByText(/Confirm & Start/i));
    
    fireEvent.click(screen.getByText(/End Session/i));
  
    expect(screen.getByText(/End Current Session\?/i));
  
    fireEvent.click(screen.getByText(/Confirm & End Session/i));
    
    expect(screen.getByText(/Start Tracking Session/i));
    expect(screen.queryByText(/End Session/i)).not;
  });
});
