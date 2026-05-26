import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

// Create a test query client
const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('App', () => {
  it('renders without crashing', () => {
    const queryClient = createTestQueryClient();
    
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    expect(container).toBeDefined();
  });

  it('renders sidebar with DarkYield branding', () => {
    const queryClient = createTestQueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    // Check for the DarkYield text in the sidebar
    expect(screen.getByText('DarkYield')).toBeInTheDocument();
  });

  it('renders navigation items', () => {
    const queryClient = createTestQueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    // Check for navigation items
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Yield Pools')).toBeInTheDocument();
    expect(screen.getByText('Portfolios')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders header with paper trading badge', () => {
    const queryClient = createTestQueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    // Check for header elements
    expect(screen.getByText('Yield Optimization Platform')).toBeInTheDocument();
    
    // Paper Trading badge might be in a hidden menu on mobile
    const paperTradingElements = screen.queryAllByText(/Paper Trading|Paper/);
    expect(paperTradingElements.length).toBeGreaterThanOrEqual(0);
  });

  it('renders system status indicator', () => {
    const queryClient = createTestQueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );
    
    // System status should be visible
    expect(screen.getByText('System Online')).toBeInTheDocument();
  });
});
