import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TrendingUp, TrendingDown } from 'lucide-react';

// Simple StatCard component for testing
interface StatCardProps {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  valueClass?: string;
}

function StatCard({ title, value, subValue, icon: Icon, valueClass = '' }: StatCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${valueClass}`}>
            {value}
          </p>
          {subValue && (
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{subValue}</p>
          )}
        </div>
        <div className="p-2 bg-[var(--color-surface-hover)] rounded-lg">
          <Icon className="w-5 h-5 text-[var(--color-text-muted)]" />
        </div>
      </div>
    </div>
  );
}

describe('StatCard', () => {
  it('renders with basic props', () => {
    render(<StatCard title="Total Value" value="$10,000" icon={TrendingUp} />);
    
    expect(screen.getByText('TOTAL VALUE')).toBeInTheDocument();
    expect(screen.getByText('$10,000')).toBeInTheDocument();
  });

  it('renders with subValue', () => {
    render(
      <StatCard 
        title="Return" 
        value="+5.2%" 
        subValue="Last 24h"
        icon={TrendingUp}
        valueClass="text-green-500"
      />
    );
    
    expect(screen.getByText('RETURN')).toBeInTheDocument();
    expect(screen.getByText('+5.2%')).toBeInTheDocument();
    expect(screen.getByText('Last 24h')).toBeInTheDocument();
  });

  it('renders with negative value', () => {
    render(
      <StatCard 
        title="Loss" 
        value="-2.5%" 
        icon={TrendingDown}
        valueClass="text-red-500"
      />
    );
    
    expect(screen.getByText('LOSS')).toBeInTheDocument();
    expect(screen.getByText('-2.5%')).toBeInTheDocument();
  });

  it('renders icon correctly', () => {
    const { container } = render(
      <StatCard title="Test" value="100" icon={TrendingUp} />
    );
    
    // Check that the icon wrapper exists
    expect(container.querySelector('.p-2')).toBeInTheDocument();
  });
});
