# Research Sources

QA methodology sources that informed the design of corgispec-human-qa.

## Core Frameworks

### Session-Based Test Management (SBTM)

Developed by James Bach and Michael Bolton. Structures exploratory testing into time-boxed sessions with charters, notes, and debriefs. Provides accountability without sacrificing the adaptive nature of manual testing.

- Charter-driven sessions (60-90 min)
- Session reports: bugs found, issues, notes, metrics
- Debrief structure for knowledge transfer

### Heuristic Test Strategy Model (HTSM)

Created by James Bach. A guiding framework for test strategy that considers project environment, product elements, quality criteria, and test techniques. Used here to inform risk-area identification and test focus selection.

- Product elements: structure, function, data, platform, operations
- Quality criteria: capability, reliability, usability, security, performance
- Test techniques: function testing, domain testing, stress testing, flow testing

### Risk-Based Testing

Prioritizes testing effort based on risk scores calculated as Likelihood x Impact. Higher-risk areas receive deeper exploration and more rigorous verification. Applied in this skill to guide which areas warrant manual QA attention.

- Risk Score = Likelihood x Impact
- Categorization: Critical (9), High (6-8), Medium (3-5), Low (1-2)
- Continuous re-assessment as information emerges

### Test Tours (Exploratory Strategies)

12 exploration strategies providing structured yet flexible approaches to discovering defects through manual interaction:

1. Guidebook Tour - follow documentation
2. Money Tour - test revenue-critical paths
3. Landmark Tour - navigate between key features
4. Intellectual Tour - challenge the hardest features
5. FedEx Tour - follow data through the system
6. Garbage Collector Tour - test with invalid inputs
7. Bad Neighborhood Tour - focus near known bugs
8. Museum Tour - test legacy/unchanged code
9. Back Alley Tour - test least-used features
10. All-Nighter Tour - test under sustained load
11. Saboteur Tour - disrupt resources mid-operation
12. Antisocial Tour - test unintended usage patterns

## Professional QA Standards

### Manual Testing Guide (Quash, 2026)

Comprehensive reference for structured manual testing practices including test case design, execution workflows, defect reporting, and evidence collection. Emphasizes reproducibility and clear communication in bug reports.

### Exploratory Test Management (TestQuality)

Guidance on managing exploratory testing within agile workflows. Covers session planning, real-time note-taking, and integrating findings back into the development process without losing the speed benefits of exploration.

### Building a Test Evidence Strategy (TestCollab)

Framework for collecting, organizing, and presenting test evidence. Defines what constitutes sufficient proof that testing occurred and quality was verified. Applied here in the evidence-gathering and reporting phases.

### Bug Report Standards (BrowserStack)

Industry-standard bug report structure:

- Title (concise, searchable)
- Environment (OS, browser, device)
- Steps to reproduce (numbered, specific)
- Expected vs actual behavior
- Severity and priority classification
- Supporting evidence (screenshots, logs, recordings)

## Specialized Testing

### Accessibility Testing Checklist (WCAG 2.1/2.2)

Manual verification of accessibility compliance covering:

- Perceivable: text alternatives, captions, contrast, resizing
- Operable: keyboard access, timing, seizure prevention, navigation
- Understandable: readable, predictable, input assistance
- Robust: compatible with assistive technologies

### Manual Web Application Security Testing (OWASP-based)

Security verification through manual interaction, informed by OWASP Testing Guide:

- Authentication and session management
- Input validation and injection vectors
- Authorization and access control
- Error handling and information leakage
- Business logic flaws

### User Acceptance Testing (UAT) Best Practices

Structured approach to validating that software meets business requirements from the end-user perspective:

- Acceptance criteria verification
- Real-world scenario simulation
- Stakeholder sign-off workflows
- Defect classification (blocker vs cosmetic)

### End-to-End Testing Templates

Templates for documenting complete user journeys through a system, verifying that integrated components work together correctly from input to output across all touchpoints.
