// Connects task classification to tier maps and produces
// filtered requirements for agent prompt injection.

import { TaskClassification, TaskType } from './task-classifier';
import { TierMap, TierRequirement } from './tier-maps';

export interface FilteredRequirements {
  taskType: TaskType;
  enforced: TierRequirement[];
  recommended: TierRequirement[];
  skipped: TierRequirement[];
}

export class RequirementFilter {
  private tierMaps: TierMap;

  constructor(tierMaps: TierMap) {
    this.tierMaps = tierMaps;
  }

  filter(classification: TaskClassification): FilteredRequirements {
    const requirements = this.tierMaps[classification.taskType] || [];

    const enforced: TierRequirement[] = [];
    const recommended: TierRequirement[] = [];
    const skipped: TierRequirement[] = [];

    for (const req of requirements) {
      switch (req.tier) {
        case 'enforce':
          enforced.push(req);
          break;
        case 'recommend':
          recommended.push(req);
          break;
        case 'skip':
          skipped.push(req);
          break;
      }
    }

    return { taskType: classification.taskType, enforced, recommended, skipped };
  }

  toPromptInjection(filtered: FilteredRequirements): string {
    const sections: string[] = [];

    if (filtered.enforced.length > 0) {
      sections.push('## Required (these are mandatory, your code will be rejected if missing):');
      for (const req of filtered.enforced) {
        sections.push(`- ${req.description}`);
      }
    }

    if (filtered.recommended.length > 0) {
      if (sections.length > 0) sections.push('');
      sections.push('## Recommended (include where applicable):');
      for (const req of filtered.recommended) {
        sections.push(`- ${req.description}`);
      }
    }

    // Tier 3 (skip) items are intentionally absent from the prompt.
    // Not mentioned, not suggested, not hinted at.

    return sections.join('\n');
  }
}
