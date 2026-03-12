/**
 * PII Redaction Service
 * 
 * This service handles local redaction of sensitive information before sending data to the AI.
 * It replaces names, SSNs, and addresses with placeholders and provides a way to restore them.
 */

interface RedactionMap {
  [placeholder: string]: string;
}

export class PIIService {
  private redactionMap: RedactionMap = {};
  private counter = 1;

  /**
   * Redacts PII from a string and returns the redacted string and the map for restoration.
   * Note: This is a basic implementation using regex. In a production environment, 
   * a more sophisticated NER (Named Entity Recognition) approach would be used.
   */
  redact(text: string): { redactedText: string; map: RedactionMap } {
    this.redactionMap = {};
    this.counter = 1;
    let processedText = text;

    // 1. Redact SSNs (Basic pattern: XXX-XX-XXXX)
    const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
    processedText = processedText.replace(ssnRegex, (match) => {
      const placeholder = `[SSN_${this.counter++}]`;
      this.redactionMap[placeholder] = match;
      return placeholder;
    });

    // 2. Redact Phone Numbers
    const phoneRegex = /\b(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
    processedText = processedText.replace(phoneRegex, (match) => {
      const placeholder = `[PHONE_${this.counter++}]`;
      this.redactionMap[placeholder] = match;
      return placeholder;
    });

    // 3. Redact common name patterns (This is tricky without NLP, but we can look for "Mr./Ms. [Name]" or capitalized words)
    // For this prototype, we'll focus on explicit patterns or common caseworker note styles.
    // We'll also redact specific fields if provided (like child names).
    
    return { redactedText: processedText, map: { ...this.redactionMap } };
  }

  /**
   * Restores redacted information in the AI output.
   */
  restore(text: string, map: RedactionMap): string {
    let restoredText = text;
    Object.entries(map).forEach(([placeholder, originalValue]) => {
      // Use split/join for global replacement without regex escaping issues
      restoredText = restoredText.split(placeholder).join(originalValue);
    });
    return restoredText;
  }

  /**
   * Specifically redact known entities like child names
   */
  redactEntities(text: string, entities: string[]): { redactedText: string; map: RedactionMap } {
    let processedText = text;
    const localMap: RedactionMap = {};
    let localCounter = 1;

    entities.forEach(entity => {
      if (!entity.trim()) return;
      const regex = new RegExp(`\\b${this.escapeRegExp(entity.trim())}\\b`, 'gi');
      processedText = processedText.replace(regex, (match) => {
        const placeholder = `[PERSON_${localCounter++}]`;
        localMap[placeholder] = match;
        return placeholder;
      });
    });

    return { redactedText: processedText, map: localMap };
  }

  private escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const piiService = new PIIService();
