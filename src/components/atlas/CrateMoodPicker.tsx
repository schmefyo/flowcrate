type Props = {
  moods: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

/** Shared multi-select mood control for creating and editing crates. */
export function CrateMoodPicker({ moods, selected, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {moods.map((mood) => {
        const isSelected = selected.includes(mood);
        return (
          <button
            key={mood}
            type="button"
            aria-pressed={isSelected}
            onClick={() =>
              onChange(
                isSelected ? selected.filter((value) => value !== mood) : [...selected, mood],
              )
            }
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              isSelected
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {mood}
          </button>
        );
      })}
    </div>
  );
}
