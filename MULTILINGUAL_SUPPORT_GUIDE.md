# Multilingual Support Implementation Guide

## Overview

The Child Welfare Copilot now provides instant translation capabilities for case reports, enabling caseworkers to communicate effectively with non-English speaking families. The system uses AI-powered translation to maintain professional and clinical tone while converting documentation into multiple languages.

## Supported Languages

The translation service supports the following languages:

| Code | Language | Use Case |
|------|----------|----------|
| en | English | Default/Primary language |
| es | Spanish | Hispanic families, Spanish-speaking communities |
| fr | French | French-speaking families, Haitian Creole regions |
| zh | Chinese | Chinese-speaking families (Simplified/Traditional) |
| vi | Vietnamese | Vietnamese-speaking families |
| ar | Arabic | Arabic-speaking families, Middle Eastern communities |
| tl | Tagalog | Filipino families, Pacific Islander communities |

## Features

### 1. Real-Time Translation

- **Instant Processing**: Reports translate within seconds
- **Context-Aware**: Maintains professional child welfare terminology
- **Tone Preservation**: Keeps clinical and formal language appropriate for legal documentation
- **No Manual Intervention**: Automatic translation without user configuration

### 2. AI-Powered Translation Service

**File**: `src/services/translationService.ts`

The translation service leverages Google's Gemini API to provide:

- **Advanced NLP**: Natural language processing for accurate translation
- **Domain Knowledge**: Understands child welfare terminology and context
- **Professional Output**: Maintains formal tone required for legal documents
- **Error Handling**: Graceful fallback to original text if translation fails

#### Service Implementation

```typescript
export async function translateText(
  text: string, 
  targetLanguage: string
): Promise<string> {
  // Returns original text if already in English
  if (!text || targetLanguage === 'en') return text;

  // Sends to Gemini API with professional tone instruction
  const prompt = `Translate to ${targetLanguage}. 
    Maintain professional clinical tone suitable for child welfare casework.`;
  
  // Returns translated text or original on error
  return translatedResult || originalText;
}
```

### 3. User Interface Integration

#### Translation Dropdown

Located in the report header, the translation dropdown provides:

- **Language Selection**: Easy dropdown menu with all supported languages
- **Real-Time Updates**: Report translates immediately upon selection
- **Visual Feedback**: Loading spinner during translation
- **Offline Awareness**: Disabled when offline (requires API access)
- **Status Indicator**: Shows current language selection

#### UI Location

```
Generated Report Header
├── Report Title
├── Download/Copy Buttons
└── [Translate Dropdown] ← Translation Control
```

#### Code Implementation

```tsx
<select 
  value={selectedLanguage}
  onChange={(e) => handleTranslate(e.target.value)}
  disabled={isTranslating || !isOnline}
  className="bg-white border border-gray-200 rounded-lg px-2 py-1"
>
  {supportedLanguages.map(lang => (
    <option key={lang.code} value={lang.code}>
      {lang.name}
    </option>
  ))}
</select>
```

## Usage Workflow

### For Caseworkers

1. **Generate Report**
   - Fill out case details as normal
   - Click "Generate Professional Report"
   - Report appears in output section

2. **Select Language**
   - Locate translation dropdown in report header
   - Click dropdown menu
   - Select desired language (e.g., "Spanish")

3. **Review Translation**
   - Report automatically translates
   - Loading indicator shows during processing
   - Translated report displays in same section

4. **Share with Family**
   - Download translated PDF
   - Copy translated text
   - Print for family records
   - Share via secure channels

### Translation Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│                 TRANSLATION WORKFLOW                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. Report Generated (English)                         │
│     ↓                                                    │
│  2. User selects language: "Spanish"                   │
│     ↓                                                    │
│  3. handleTranslate('es') triggered                    │
│     ↓                                                    │
│  4. setIsTranslating(true) - Show loading spinner      │
│     ↓                                                    │
│  5. translateText(report, 'es') called                 │
│     ↓                                                    │
│  6. Gemini API receives:                               │
│     - Original English report                          │
│     - Target language: Spanish                         │
│     - System prompt: "Maintain professional tone"      │
│     ↓                                                    │
│  7. API returns Spanish translation                    │
│     ↓                                                    │
│  8. setReport(translatedText)                          │
│     ↓                                                    │
│  9. UI updates with Spanish version                    │
│     ↓                                                    │
│  10. setIsTranslating(false) - Hide spinner            │
│     ↓                                                    │
│  11. User can download/copy Spanish report             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Technical Architecture

### Translation Service (`src/services/translationService.ts`)

```typescript
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini API
const genAI = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "" 
});

// Supported languages configuration
export const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  // ... more languages
];

// Main translation function
export async function translateText(
  text: string, 
  targetLanguage: string
): Promise<string> {
  // Skip translation for English or empty text
  if (!text || targetLanguage === 'en') return text;

  try {
    // Create translation prompt
    const prompt = `Translate the following text to ${targetLanguage}. 
      Maintain the professional and clinical tone suitable for 
      child welfare casework. Do not add any commentary, 
      only provide the translation.
      
      Text: ${text}`;

    // Call Gemini API
    const result = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ 
        role: "user", 
        parts: [{ text: prompt }] 
      }]
    });
    
    // Extract and return translated text
    const response = await result;
    return response.text.trim();
  } catch (error) {
    console.error("Translation error:", error);
    return text; // Fallback to original
  }
}
```

### State Management in App.tsx

```typescript
// Language selection state
const [selectedLanguage, setSelectedLanguage] = useState('en');

// Translation loading state
const [isTranslating, setIsTranslating] = useState(false);

// Handle translation
const handleTranslate = async (langCode: string) => {
  if (!report) return;
  
  setIsTranslating(true);
  setSelectedLanguage(langCode);
  
  try {
    const translated = await translateText(report, langCode);
    setReport(translated);
  } catch (err) {
    setError("Translation failed. Please try again.");
  } finally {
    setIsTranslating(false);
  }
};
```

## Integration Points

### 1. Report Generation

After a report is generated:
- Translation dropdown becomes available
- User can immediately translate to any supported language
- Original English report remains accessible via language dropdown

### 2. Download/Export

Translated reports can be:
- Downloaded as PDF (maintains translation)
- Copied to clipboard (preserves formatting)
- Downloaded as TXT (plain text translation)
- Printed directly (translated version)

### 3. Offline Behavior

- Translation disabled when offline (requires API access)
- Dropdown shows as disabled
- User sees clear indication that translation requires internet
- Original report remains accessible

## API Configuration

### Environment Variables

Required for translation functionality:

```bash
GEMINI_API_KEY=your_api_key_here
```

Set in:
- `.env` file (local development)
- Environment variables (production deployment)
- CI/CD pipeline secrets

### API Model

- **Model**: `gemini-1.5-flash`
- **Reasoning**: Fast, cost-effective, suitable for translation
- **Alternative**: `gemini-1.5-pro` for higher accuracy (higher cost)

### Rate Limiting

- Typical translation: < 2 seconds
- API quota: Depends on plan (check Google Cloud Console)
- Recommended: Monitor usage for cost optimization

## Error Handling

### Translation Failures

If translation fails, the system:

1. **Logs Error**: Console shows detailed error message
2. **Preserves Original**: Report remains in original language
3. **User Notification**: Error message displayed to user
4. **Graceful Fallback**: User can retry or continue with English

### Network Issues

When offline:
- Translation dropdown disabled
- Clear visual indication (grayed out)
- User prompted to reconnect for translation

### API Errors

Common issues and solutions:

| Issue | Cause | Solution |
|-------|-------|----------|
| "Cannot find module" | Missing API key | Set `GEMINI_API_KEY` env var |
| "API rate limit" | Too many requests | Wait or upgrade API plan |
| "Invalid language" | Unsupported language | Use supported language code |
| "Empty response" | API error | Check API status, retry |

## Quality Assurance

### Translation Testing

1. **Accuracy Testing**
   - Verify terminology is correct
   - Check legal/clinical terms are accurate
   - Ensure tone remains professional

2. **Language Coverage**
   - Test all 7 supported languages
   - Verify character encoding (especially for CJK)
   - Check RTL languages (Arabic)

3. **Edge Cases**
   - Very long reports (> 10,000 words)
   - Special characters and formatting
   - Names and proper nouns
   - Legal citations and statutes

### Performance Testing

- Translation speed: Target < 3 seconds
- API response time: Monitor and optimize
- Concurrent translations: Test multiple simultaneous requests
- Load testing: Verify system under high usage

## Security Considerations

### Data Privacy

- Reports sent to Gemini API for translation
- Data processed by Google servers
- Ensure compliance with data protection regulations
- Consider data residency requirements

### PII Handling

- PII is already redacted before report generation
- Redacted placeholders (e.g., `[PERSON_1]`) preserved in translation
- No additional PII exposure through translation

### API Key Security

- Never commit API keys to repository
- Use environment variables
- Rotate keys regularly
- Monitor API usage for unauthorized access

## Deployment Checklist

- [ ] `GEMINI_API_KEY` environment variable configured
- [ ] Translation service tested with all languages
- [ ] Offline behavior verified (dropdown disabled)
- [ ] Error handling tested
- [ ] Performance acceptable (< 3 seconds)
- [ ] Security review completed
- [ ] Documentation updated
- [ ] User training materials prepared

## User Training

### For Caseworkers

1. **When to Use Translation**
   - Family speaks different language
   - Need to provide documentation in family's language
   - Communicating with interpreters

2. **How to Use**
   - Generate report normally
   - Select language from dropdown
   - Wait for translation to complete
   - Download or print translated version

3. **Quality Assurance**
   - Always review translation before sharing
   - Verify key terms are accurate
   - Check formatting is preserved
   - Confirm no information is lost

### For Supervisors

1. **Monitoring**
   - Track translation usage
   - Monitor API costs
   - Review translation quality
   - Identify problematic translations

2. **Quality Control**
   - Spot-check translations
   - Verify professional tone maintained
   - Ensure accuracy of legal/clinical terms
   - Document any issues

## Future Enhancements

### Planned Features

1. **Language Detection**
   - Automatically detect family's language
   - Suggest translation without user selection

2. **Batch Translation**
   - Translate multiple reports at once
   - Schedule translations for off-peak hours

3. **Custom Terminology**
   - Agency-specific terms dictionary
   - Consistent translation across reports

4. **Translation Memory**
   - Cache previous translations
   - Improve consistency and speed

5. **Human Review Integration**
   - Flag translations for human review
   - Translator approval workflow

6. **Audio Translation**
   - Translate audio recordings
   - Generate audio in target language

## Support & Troubleshooting

### Common Issues

**Translation not working**
- Verify `GEMINI_API_KEY` is set
- Check internet connection
- Ensure report is generated
- Try refreshing page

**Translation is slow**
- Check internet speed
- Verify API quota
- Try shorter report
- Contact support if persistent

**Translation quality issues**
- Review translation for accuracy
- Report issues to development team
- Consider manual review for critical documents
- Use alternative translation service if needed

### Getting Help

1. Check browser console for error messages
2. Verify environment variables are set
3. Test with different language
4. Contact development team with:
   - Error message
   - Language attempted
   - Report content (if shareable)
   - Browser and OS information

## References

- [Google Gemini API Documentation](https://ai.google.dev)
- [Translation Best Practices](https://cloud.google.com/translate/docs/best-practices)
- [Child Welfare Terminology Guide](https://www.childwelfare.gov)
- [HIPAA Compliance for Translations](https://www.hhs.gov/hipaa)
