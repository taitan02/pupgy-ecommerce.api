import { AppError } from '../../../common/errors/app-error.js';

export interface VariationInput {
  options: { name: string; values: string[] }[];
  skus: { optionValues: string[]; price: number; stock: number; code?: string; sellable?: boolean }[];
}

export interface PlannedSku {
  labels: string[];
  price: number;
  stock: number;
  code?: string;
  sellable: boolean;
}

export interface VariationPlan {
  options: { name: string; values: string[] }[];
  skus: PlannedSku[];
}

/** Separator that cannot appear in an option value, so a combination key is unambiguous. */
export const COMBINATION_SEPARATOR = '\u0000';

export const combinationKey = (labels: string[]) => labels.join(COMBINATION_SEPARATOR);

/**
 * Validates a variation grid and normalises it. Shared by product creation and by
 * editing the structure later: the rules are identical, and having them in one place
 * is what keeps the two paths from drifting apart.
 */
export function planVariations(input: VariationInput): VariationPlan {
  const options = input.options.map((option) => ({
    name: option.name.trim(),
    values: option.values.map((value) => value.trim()),
  }));

  if (options.length > 2) {
    throw AppError.conflict('A product can have at most 2 option groups');
  }

  const optionNames = options.map((option) => option.name.toLowerCase());
  if (new Set(optionNames).size !== optionNames.length) {
    throw AppError.conflict('Two option groups have the same name');
  }

  for (const option of options) {
    const lowered = option.values.map((value) => value.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      throw AppError.conflict(`Option "${option.name}" has duplicate values`);
    }
  }

  const seen = new Set<string>();
  const skus = input.skus.map((sku) => {
    const labels = sku.optionValues.map((value) => value.trim());

    if (labels.length !== options.length) {
      throw AppError.conflict(
        `Each SKU must have exactly ${options.length} option value(s), in option order`,
      );
    }

    labels.forEach((label, index) => {
      if (!options[index]!.values.includes(label)) {
        throw AppError.conflict(`"${label}" is not a value of option "${options[index]!.name}"`);
      }
    });

    const key = combinationKey(labels);
    if (seen.has(key)) {
      throw AppError.conflict('Two SKUs have the same option combination');
    }
    seen.add(key);

    return {
      labels,
      price: sku.price,
      stock: sku.stock,
      code: sku.code?.trim() || undefined,
      sellable: sku.sellable ?? true,
    };
  });

  return { options, skus };
}
