# Video Storage Pipeline Diagnostic Report

**DIAGNOSTIC AGENT FINDINGS**
Date: 2025-09-27
Analysis Target: Video Storage System Core Pipeline Issues

## Executive Summary

### 🚨 CRITICAL FINDINGS
The video storage system exhibits **severe disconnect issues** between different layers:

1. **Catalog Corruption**: Committed scope catalog is EMPTY but index contains 5 items
2. **Scope Resolution Failure**: Memory items show wrong scope after retrieval
3. **FFmpeg Frame Extraction Issues**: Video decoding fails with "empty output file" errors
4. **Search-Storage Disconnect**: Search returns 5 items from empty catalog

### System Health: ⚠️ **DEGRADED** (Despite 4/4 tests passing - false positive)

---

## 1. Scope Analysis Results

### Key Issues Discovered:

#### **Issue 1: Catalog-Index Synchronization Failure**
```
Committed Catalog: 0 items (EMPTY)
Consolidated Index: 5 items
Video File: 44.1 KB (contains data)
```

**Evidence**:
- `/Users/administrator/Development/Claude/llm_memory_mcp/.llm-memory/catalog.json` contains only `{}`
- `/Users/administrator/Development/Claude/llm_memory_mcp/.llm-memory/segments/consolidated-index.json` contains 5 valid entries
- Video file exists and has content (45,183 bytes)

**Root Cause**: Catalog rebuild process is failing or not being triggered properly.

#### **Issue 2: Scope Mismatch During Retrieval**
```
Expected: committed scope
Actual: local scope (wrong resolution)
```

**Evidence**: Items marked as `local` in some catalogs are being returned as `committed` during direct retrieval.

**Root Cause**: MemoryManager scope priority order (committed → local → global) is causing cross-contamination.

---

## 2. Video Pipeline Integrity Analysis

### Critical FFmpeg Frame Extraction Failure

#### **Primary Issue: Empty Frame Extraction**
```
Error: FFmpeg created empty output file
Command: ffmpeg -hide_banner -loglevel error -ss 0 -i consolidated.mp4 -vf select='eq(n\,0)',format=rgba -f rawvideo -pix_fmt rgba -frames:v 1 -an -y /tmp/frame-*.raw
```

#### **Pipeline Breakdown Points:**

1. **Frame Extraction Layer**: FFmpeg commands produce 0-byte output files
2. **QR Decoding Layer**: Cannot process empty frames
3. **Memory Reconstruction**: Fails due to missing QR data
4. **Cache Layer**: Stores null results, propagating failures

#### **Technical Analysis:**
- FFmpeg version: 8.0 (confirmed working)
- Video format: MP4 (standard)
- Frame count: 5 frames detected correctly
- Frame seeking: Timestamp calculation may be incorrect

---

## 3. Index Corruption Detection

### ✅ **Index Structure Integrity: HEALTHY**
- Frame mapping: 5/5 frames correctly mapped
- Content hashes: 5/5 hashes present and valid
- No duplicate frame assignments
- No orphaned frames

### ⚠️ **Catalog-Index Disconnect: CRITICAL**
All 5 index items are marked as "orphaned" because catalog is empty:
```json
{
  "01K61J6CSKAPVWRP2KEHE9TPK2": "missing from catalog",
  "01K62CY81PG2JQ0KRWVBVFRRVF": "missing from catalog",
  "01K62EWMBB6Y5XS82KQ42KFRKA": "missing from catalog",
  "01K62F1QKZ040BVZC5N7B9K0GM": "missing from catalog",
  "01K62F9TZ673N44172J53VNFCD": "missing from catalog"
}
```

---

## 4. Search Integration Analysis

### **Critical Search-Storage Disconnect**

#### **Symptom**:
```
Search Query "phase": 0 results
Empty Search: 5 results
Catalog Count: 0 items
Actual Index: 5 items
```

#### **Root Cause Analysis**:
1. **InvertedIndexer** reads from video storage successfully (finds 5 items)
2. **Catalog** is empty (returns 0 items)
3. **Search results** come from indexer, not catalog
4. **Direct retrieval** attempts to use catalog first, fails

#### **Impact**:
- Search returns items that cannot be retrieved
- User sees inconsistent item counts
- Memory operations fail unpredictably

---

## 5. Data Corruption Evidence

### **File System Analysis**:
```bash
.llm-memory/
├── catalog.json          # 🚨 EMPTY: {}
├── config.json           # ✅ Valid: {"storage": {"backend": "video"}}
└── segments/
    ├── consolidated.mp4   # ✅ Valid: 45,183 bytes
    └── consolidated-index.json  # ✅ Valid: 5 items mapped
```

### **Content Hash Consistency**:
All content hashes in the index appear valid:
- `0d9853139bed556f68c4d1c3cec8bad06aaa2b6d4a7074d174ff144866697d93`
- `1574ac9872681f94a17c5fb96995d0e956a17d55af916a6ac5fd8e0ce86fbbfc`
- etc.

---

## 6. Specific Technical Issues Found

### **VideoStorageAdapter.ts Issues**:

1. **getSerializedPayload() Method**:
   - FFmpeg frame extraction consistently fails
   - No fallback for frame extraction errors
   - Cache population fails due to upstream errors

2. **rebuildCatalog() Method**:
   - May not be called automatically when needed
   - Relies on successful video decoding (which is failing)

3. **Catalog Management**:
   - Catalog becomes desynchronized with index
   - No automatic recovery mechanism

### **MemoryManager.ts Issues**:

1. **detectStorageBackend() Method**:
   - Correctly detects video backend
   - But doesn't validate video pipeline health

2. **Scope Resolution**:
   - Priority ordering causes scope confusion
   - Cross-scope contamination during retrieval

### **VideoDecoder.ts Issues**:

1. **Frame Extraction Dependency**:
   - Heavily dependent on FrameExtractor working correctly
   - No graceful degradation when FFmpeg fails

2. **Error Handling**:
   - Retries don't address core FFmpeg command issues
   - Recovery strategies are insufficient

---

## 7. Recommended Fixes

### **Immediate Actions (High Priority)**:

1. **Fix FFmpeg Frame Extraction**:
   ```bash
   # Test manual frame extraction
   ffmpeg -i .llm-memory/segments/consolidated.mp4 -vf "select=eq(n\,0)" -f rawvideo -pix_fmt rgba -frames:v 1 test_frame.raw
   ```

2. **Rebuild Catalog**:
   ```typescript
   // Force catalog rebuild from index
   await videoStorageAdapter.rebuildCatalog();
   ```

3. **Add Video Pipeline Health Check**:
   ```typescript
   async validateVideoPipeline() {
     // Test frame extraction + QR decoding
     // Rebuild catalog if video accessible but catalog empty
   }
   ```

### **Medium Priority**:

1. **Implement Catalog Auto-Recovery**:
   - Detect empty catalog + non-empty index
   - Automatically trigger rebuild
   - Add catalog validation hooks

2. **Enhance Error Handling**:
   - Better FFmpeg error diagnostics
   - Graceful degradation strategies
   - Fallback to file storage if video fails

3. **Fix Scope Resolution**:
   - Validate scope consistency after retrieval
   - Add scope validation to read operations
   - Clear cross-scope contamination

### **Long-term (Low Priority)**:

1. **Add Pipeline Monitoring**:
   - Health checks for video components
   - Automatic corruption detection
   - Performance monitoring for frame extraction

2. **Implement Video Storage Validation**:
   - Periodic integrity checks
   - Content hash verification
   - Index-catalog synchronization validation

---

## 8. Test Commands for Validation

### **Manual FFmpeg Test**:
```bash
cd /Users/administrator/Development/Claude/llm_memory_mcp/.llm-memory
ffmpeg -i segments/consolidated.mp4 -vf "select=eq(n\,0)" -f rawvideo -pix_fmt rgba -frames:v 1 -y test_frame.raw
ls -la test_frame.raw  # Should show >0 bytes
```

### **Catalog Rebuild Test**:
```typescript
import { VideoStorageAdapter } from './src/storage/VideoStorageAdapter.js';
const adapter = new VideoStorageAdapter('./.llm-memory', 'committed');
await adapter.rebuildCatalog();
```

### **Index Validation Test**:
```bash
jq '.totalItems, .items | keys | length' .llm-memory/segments/consolidated-index.json
# Should show same count for both
```

---

## Conclusion

The video storage system has **functional video encoding and storage** but suffers from **critical retrieval pipeline failures**. The core issues are:

1. **FFmpeg frame extraction producing empty files**
2. **Catalog becoming desynchronized from index**
3. **Search returning items that cannot be retrieved**

**Priority**: Fix FFmpeg frame extraction first, then rebuild catalog to restore system functionality.

**Risk Level**: HIGH - System appears functional in listings but actual memory retrieval fails silently.

**Recovery Time**: 2-4 hours with proper debugging of FFmpeg command generation.