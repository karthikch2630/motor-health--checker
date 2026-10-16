# Product Requirements Document (PRD)

## Motor Health Checker

**Version:** 1.0  
**Status:** Initial MVP Specification  
**Application Type:** Web Application  
**Primary Goal:** Check electric motor operating parameters against stored reference values.

---

## 1. Product Overview

Motor Health Checker is a simple web application that helps users assess the operating condition of electric motors.

Users can register a motor, enter its measured parameters through a dashboard, compare the readings with reference values stored in a database, and view an assessment showing whether the readings are within the applicable limits or indicate a potential problem.

The application also saves test history so users can review previous readings and diagnostic results.

The initial version will use manual data entry. Automatic sensor integration and advanced predictive analytics are outside the MVP scope.

## 2. Problem Statement

Motor readings are often recorded manually, and engineers may need to compare those readings against specifications or previous test records.

Without a centralized system, this process can be inconsistent and make it difficult to identify abnormal measurements or review historical performance.

Motor Health Checker provides a centralized way to store motor information, evaluate measurements and record diagnostic findings.

## 3. Product Goals

The application must:

1. Allow users to register electric motors.
2. Store motor specifications and reference values.
3. Allow users to enter measured motor parameters.
4. Compare measurements against applicable reference limits.
5. Display a clear diagnostic assessment.
6. Explain which readings are abnormal and why.
7. Save readings and results for future reference.
8. Provide a simple, responsive dashboard.
9. Run locally using free development tools and use available free hosting and database tiers where possible.

## 4. Target Users

### Primary Users

**Maintenance Engineers**
- Register motors.
- Enter measurements.
- Review diagnostic findings.
- Inspect historical readings.

**Electrical Technicians**
- Record measured parameters.
- Submit motor tests.
- Review assessment results.

**Maintenance Managers**
- Review motor status.
- Identify motors requiring inspection.
- View previous test results.

The MVP may initially be used by one authorized user. Multi-user access can be enabled when authentication and permissions are configured.

## 5. Core User Workflow

1. Open the dashboard.
2. Register a motor or select an existing motor.
3. Open the motor testing page.
4. Enter the measured parameters.
5. Submit the test.
6. Retrieve the applicable reference values.
7. Validate and compare the readings.
8. Display the diagnostic result.
9. Save the test and assessment in the database.
10. Review the test later through the motor's history.

**Expected outcome:** Users can determine whether the submitted readings fall within the configured reference limits and identify measurements that need further investigation.

## 6. MVP Features

### 6.1 Dashboard

The dashboard should display:

- Total registered motors.
- Number of motors with normal assessments.
- Number of motors with warnings.
- Number of motors with suspected faults.
- Number of assessments with insufficient data.
- Recent motor tests.

Provide quick actions:

- Add Motor.
- View Motors.
- Start New Test.
- View Test History.

All statistics must be based on actual saved application data, not hardcoded demonstration values.

### 6.2 Motor Registration

Users must be able to register and maintain motor information.

**Fields**

- Motor ID or equipment tag.
- Motor name.
- Motor type.
- Manufacturer.
- Model.
- Serial number, if available.
- Rated voltage (V).
- Rated current (A).
- Rated power and unit.
- Rated frequency (Hz).
- Rated speed (RPM).
- Number of phases.
- Installation location.
- Notes.

Fields should be required only when necessary for the selected motor type and diagnostic rules.

**Requirements**
- Create a motor.
- View motor details.
- Edit motor details.
- Search motors.
- Filter motors.
- View associated test history.

### 6.3 Reference Parameter Data

The application must store the reference information used for comparisons.

Each reference entry should include:

- Applicable motor type or configuration.
- Parameter name.
- Measurement unit.
- Applicable lower or upper limits, as appropriate.
- Warning or critical thresholds, when approved and available.
- Applicable operating conditions.
- Reference source.
- Version or effective date.
- Approval status.

Reference data must be configurable rather than embedded throughout the frontend.

The application must not invent engineering limits. Reference values should come from appropriate manufacturer documentation, applicable standards or approved engineering procedures.

If the required reference data is missing, the system must explain that it cannot complete a reliable assessment.

### 6.4 Manual Parameter Entry

Users must be able to select a registered motor and enter measurements.

Initial supported parameters:

| Parameter | Unit | Purpose |
|---|---|---|
| Voltage | V | Evaluate applicable voltage limits and imbalance. |
| Current | A | Evaluate current limits and phase imbalance where available. |
| Temperature | °C | Evaluate applicable thermal limits. |
| Vibration | mm/s or a defined acceleration unit | Evaluate vibration measurements. |
| Rotational speed | RPM | Compare measured and expected speed. |
| Frequency | Hz | Evaluate applicable frequency limits. |

Additional parameters, such as power factor, can be added when their reference data and evaluation rules are defined.

**Test fields**
- Selected motor.
- Test date and time.
- Measured parameter values.
- Measurement units.
- Relevant operating conditions.
- Technician notes, if applicable.

**Validation**
- Required values must be present.
- Numeric fields must contain valid numbers.
- Units must be supported.
- Invalid input must be rejected with a useful message.
- Missing reference information must be reported.
- Measurement values and units must be saved accurately.

### 6.5 Parameter Comparison

When a user submits a test, the application must:

1. Retrieve the selected motor's specifications.
2. Retrieve the applicable reference profile.
3. Validate the submitted readings.
4. Normalize units where conversion is supported.
5. Compare readings against approved reference limits.
6. Evaluate any configured diagnostic rules.
7. Generate parameter-level findings.
8. Determine the overall assessment status.
9. Save the assessment and its findings.
10. Display the result.

The comparison logic should be implemented in a reusable TypeScript module and should not be duplicated across UI components.

### 6.6 Diagnostic Results

Each completed assessment must display:

- Motor identification.
- Test date and time.
- Overall assessment status.
- Measured values and units.
- Applicable reference limits.
- Abnormal parameters.
- Explanation of each finding.
- Possible causes, when supported.
- Recommended inspection actions, when configured.
- Missing information, if any.

The application must distinguish observed abnormal measurements from suspected underlying faults.

### 6.7 Assessment Statuses

Use the following status values consistently:

**NORMAL**

All required parameters have been evaluated against applicable approved limits, and no configured abnormality has been identified.

**WARNING**

One or more measurements require attention or additional investigation.

**FAULT_SUSPECTED**

A configured diagnostic rule indicates a possible motor fault requiring further investigation.

**INSUFFICIENT_DATA**

Required measurements, reference limits or operating conditions are missing or invalid.

**NOT_ASSESSED**

No diagnostic assessment has been completed.

A motor must not be classified as normal merely because no fault was detected when required information is missing.

### 6.8 Test History

Users must be able to:

- View previous tests for a motor.
- View individual test results.
- Review historical measurements.
- Filter tests by date.
- Compare selected readings.
- View parameter trends where sufficient data exists.

Every test must be stored as a separate record. A new test must not overwrite previous measurements or assessments.

### 6.9 Basic Reporting

If included in the initial implementation, users should be able to generate a PDF report containing:

- Motor specifications.
- Test date and time.
- Measured parameters.
- Applicable reference limits.
- Diagnostic status.
- Findings and explanations.
- Recommended inspection actions.
- Assessment limitations.

Reports must reflect saved assessment data rather than recomputing results from potentially changed reference values.

## 7. Application Pages

### Page 1: Dashboard

Displays summary cards, recent tests and shortcuts to common actions.

### Page 2: Motor List

Displays registered motors with search, filters and current assessment information.

### Page 3: Add/Edit Motor

A form for entering and updating motor specifications.

### Page 4: Motor Details

Displays motor specifications, latest assessment and historical tests.

### Page 5: New Motor Test

Allows the user to enter measurements and submit them for evaluation.

### Page 6: Diagnostic Results

Displays the assessment, abnormal parameters, reference limits and explanations.

### Page 7: Reference Data

Allows authorized users to manage approved parameter definitions and reference profiles.

### Page 8: Test History

Displays previous tests and supports filtering by motor and date.

## 8. Data Requirements

The application should use the following core database entities:

### Motors
Stores motor identification and specifications.

### Reference Profiles
Stores reference configurations and source information.

### Parameter Definitions
Stores parameter names, units and metadata.

### Reference Limits
Stores approved limits associated with the applicable reference profiles.

### Test Sessions
Stores test metadata and the motor being tested.

### Test Readings
Stores the measured parameter values and units.

### Diagnostic Results
Stores the overall assessment and rule/profile versions used.

### Diagnostic Findings
Stores abnormal readings, explanations and recommended actions.

The database relationships, constraints and indexes must be defined in `DATABASE_DESIGN.md`.

Historical readings and assessment results must remain traceable to the reference data used when the assessment was performed.

## 9. Technology Constraints

The MVP must use the following technologies:

- React.
- TypeScript.
- Vite.
- Tailwind CSS.
- Supabase PostgreSQL.
- Supabase JavaScript client.
- Supabase Row Level Security.
- Vitest for diagnostic unit tests.

Zustand, TanStack Query, Recharts and Zod may be used where appropriate.

Do not introduce a separate Express backend, Prisma ORM, microservices, paid AI services or unnecessary infrastructure.

Keep the project simple enough to develop and run locally.

## 10. Security and Data Protection

- Enable appropriate Row Level Security policies.
- Do not expose privileged database credentials in frontend code.
- Validate all submitted values.
- Restrict reference-data changes to authorized users.
- Preserve historical diagnostic records.
- Prevent unauthorized access to motor records.
- Keep secrets out of Git.
- Use environment variables for Supabase configuration.

Hiding a frontend control is not sufficient security. Database permissions must enforce access restrictions.

## 11. Non-Functional Requirements

### Usability
- Simple and understandable interface.
- Clear measurement labels and units.
- Responsive layout.
- Useful validation messages.
- Readable diagnostic findings.

### Performance
- Avoid unnecessary database requests.
- Load historical records using pagination when appropriate.
- Keep comparison logic lightweight.
- Display loading indicators during database operations.

### Reliability
- Save test readings and assessments consistently.
- Handle network and database errors.
- Avoid duplicate test submissions where practical.
- Preserve historical results.
- Never display a successful save when the database operation failed.

### Maintainability
- Use reusable React components.
- Use TypeScript types.
- Separate UI, database access and diagnostic calculations.
- Document reference data and diagnostic rules.
- Keep dependencies to a minimum.

## 12. Out of Scope

The initial MVP does not include:

- Automatic sensor data collection.
- IoT or PLC integration.
- Real-time monitoring.
- Machine-learning-based fault prediction.
- Remaining useful life estimation.
- Automatic motor shutdown or control.
- Complex enterprise asset management.
- Paid external services.
- Guaranteed identification of every motor fault.

These features may be considered after the basic manual diagnostic workflow has been implemented and validated.

## 13. Acceptance Criteria

The MVP is accepted when:

- A user can register and edit a motor.
- Motor information is saved in Supabase.
- Approved reference values can be stored and retrieved.
- A user can enter test measurements.
- Invalid values and unsupported units are handled correctly.
- The application compares measurements with applicable reference limits.
- The result includes an understandable explanation.
- Missing reference data or required measurements produce an insufficient-data result.
- Each test is saved without overwriting previous tests.
- Historical test results can be viewed.
- Database access is protected by appropriate RLS policies.
- Diagnostic functions have automated tests.
- The application builds and runs locally.
- Setup instructions are documented.

## 14. Future Enhancements

Potential future features include:

- Automatic sensor readings.
- Live motor monitoring.
- More detailed fault-detection rules.
- Additional motor types.
- Email notifications.
- Advanced trend analysis.
- Predictive maintenance based on validated historical data.

These features must not delay completion of the initial MVP.

## 15. Final Product Definition

Motor Health Checker is a lightweight web application for registering motors, entering measurements, comparing readings with approved database reference values and reviewing diagnostic results.

Its main purpose is to provide a straightforward and traceable motor assessment workflow without unnecessary infrastructure.

**Core product flow:**

Register Motor → Enter Parameters → Compare with Reference Data → Display Assessment → Save History

The first release should prioritize simplicity, reliable data storage, explainable comparisons and a clean user interface.