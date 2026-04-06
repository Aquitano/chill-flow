interface ProgressBarProps {
    value: number;
    colorFrom: string;
    colorTo: string;
}

export const ProgressBar = ({ value, colorFrom, colorTo }: ProgressBarProps) => (
    <div className="h-2 rounded-full bg-white/10">
        <div
            className={`h-2 rounded-full bg-linear-to-r from-${colorFrom} to-${colorTo}`}
            style={{ width: `${value}%` }}
        />
    </div>
);
