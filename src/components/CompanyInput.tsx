"use client";

import { useState } from "react";

interface CompanyInputProps {
  onSubmit: (name: string) => void;
  isLoading: boolean;
}

export default function CompanyInput({ onSubmit, isLoading }: CompanyInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSubmit(value.trim());
  }

  return (
    <form className="input-row" onSubmit={handleSubmit}>
      <label htmlFor="company" className="input-row__label">
        COMPANY
      </label>
      <input
        id="company"
        className="input-row__field"
        type="text"
        placeholder="e.g. Nvidia, Zomato, Tata Motors…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isLoading}
        autoFocus
      />
      <button className="input-row__button" type="submit" disabled={isLoading}>
        {isLoading ? "Researching…" : "Open File →"}
      </button>
    </form>
  );
}
