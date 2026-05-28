const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, index) =>
  String(index + 1),
);

function formatOrdinalDay(day: string | number | null | undefined) {
  if (day === null || day === undefined || day === "") {
    return "-";
  }

  const value = Number(day);
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    return String(day);
  }

  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";

  return `${value}${suffix}`;
}

export { DAY_OF_MONTH_OPTIONS, formatOrdinalDay };
