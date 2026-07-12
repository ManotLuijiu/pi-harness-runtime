# RFC-0038 Implementation Tasks

## Phase 1: Detector Core

- [ ] Create `packages/framework-detector/` directory
- [ ] Define types (`FrameworkDetection`, `DetectionSignal`, etc.)
- [ ] Create `FrameworkDetector` class
- [ ] Implement `detect()` method
- [ ] Implement `quickDetect()` method

## Phase 2: Signatures

- [ ] Create `FrameworkSignatureRegistry`
- [ ] Define detection patterns for:
  - [ ] Frappe/ERPNext
  - [ ] Frappe SPA
  - [ ] Next.js
  - [ ] React (Vite)
  - [ ] React (CRA)
  - [ ] Vue.js
  - [ ] Django
  - [ ] Laravel
  - [ ] Spring Boot
  - [ ] Ruby on Rails
- [ ] Implement pattern weighting

## Phase 3: Scanners

- [ ] Create `FileScanner` class
- [ ] Implement directory traversal
- [ ] Implement pattern matching
- [ ] Create `PackageScanner` for package.json analysis
- [ ] Create `ConfigScanner` for config file parsing
- [ ] Add parallel scanning support

## Phase 4: Version Detection

- [ ] Create `VersionDetector` class
- [ ] Implement Frappe version detection
- [ ] Implement Next.js version detection
- [ ] Implement Django version detection
- [ ] Implement Laravel version detection
- [ ] Add version caching

## Phase 5: Caching & Watching

- [ ] Create detection cache
- [ ] Implement cache invalidation
- [ ] Create `FileWatcher` for real-time updates
- [ ] Implement callback-based notifications

## Phase 6: Capabilities & Recommendations

- [ ] Implement `FrameworkCapability` detection
- [ ] Create `StrategyRecommendation` engine
- [ ] Add recommended seed strategies
- [ ] Add recommended E2E strategies

## Phase 7: Testing & Documentation

- [ ] Create test fixtures for each framework
- [ ] Test detection accuracy
- [ ] Test version detection
- [ ] Performance testing
- [ ] Write documentation
