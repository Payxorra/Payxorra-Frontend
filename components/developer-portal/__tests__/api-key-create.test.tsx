import React from 'react';
import { render, screen, waitFor } from '@testing-library/react'; // eslint-disable-line @typescript-eslint/no-unused-vars
import userEvent from '@testing-library/user-event';
import { ApiKeyCreate } from '../api-key-create';

// Mock the components
jest.mock('@/components/ui/modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode, isOpen: boolean }) => isOpen ? <div data-testid="modal">{children}</div> : null
}));
jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: unknown) => <button {...props}>{children}</button>
}));
jest.mock('@/components/ui/input', () => ({
  Input: (props: unknown) => <input data-testid="input" {...props} />
}));

describe('ApiKeyCreate', () => {
  const mockOnClose = jest.fn();
  const mockOnCreate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    render(<ApiKeyCreate isOpen={false} onClose={mockOnClose} onCreate={mockOnCreate} />);
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });

  it('renders form elements when isOpen is true', () => {
    render(<ApiKeyCreate isOpen={true} onClose={mockOnClose} onCreate={mockOnCreate} />);
    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByText('Key Name')).toBeInTheDocument();
    expect(screen.getByText('Scopes')).toBeInTheDocument();
    expect(screen.getByText('Create Key')).toBeInTheDocument();
  });

  it('enables Create Key button only when name is provided and at least one scope is selected', async () => {
    render(<ApiKeyCreate isOpen={true} onClose={mockOnClose} onCreate={mockOnCreate} />);
    
    const createButton = screen.getByText('Create Key');
    expect(createButton).toBeDisabled();

    // Type name
    const input = screen.getByTestId('input');
    await userEvent.type(input, 'Test Key');
    expect(createButton).toBeDisabled();

    // Select scope
    const scopeButton = screen.getByText('validator:read');
    await userEvent.click(scopeButton);
    expect(createButton).not.toBeDisabled();
  });

  it('calls onCreate with correct arguments and shows success state', async () => {
    render(<ApiKeyCreate isOpen={true} onClose={mockOnClose} onCreate={mockOnCreate} />);
    
    const input = screen.getByTestId('input');
    await userEvent.type(input, 'Test Key');
    
    const scopeButton = screen.getByText('validator:read');
    await userEvent.click(scopeButton);
    
    const createButton = screen.getByText('Create Key');
    await userEvent.click(createButton);

    expect(mockOnCreate).toHaveBeenCalledWith('Test Key', ['validator:read']);
    
    // Check success state
    expect(screen.getByText('API Key Created Successfully')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', async () => {
    render(<ApiKeyCreate isOpen={true} onClose={mockOnClose} onCreate={mockOnCreate} />);
    const cancelButton = screen.getByText('Cancel');
    await userEvent.click(cancelButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
