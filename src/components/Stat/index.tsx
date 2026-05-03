import { intComma } from '@/utils/utils';

interface IStatProperties {
  value: string | number;
  description: string;
  className?: string;
  citySize?: number;
  onClick?: () => void;
}

const Stat = ({
  value,
  description,
  className = 'pb-2 w-full',
  citySize,
  onClick,
}: IStatProperties) => (
  <div className={`rp-stat-card ${className}`} onClick={onClick}>
    <span className={`rp-stat-value text-${citySize || 5}xl font-bold italic`}>
      {intComma(value.toString())}
    </span>
    <span className="rp-stat-label text-lg font-semibold italic">
      {description}
    </span>
  </div>
);

export default Stat;
