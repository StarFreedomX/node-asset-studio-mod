// SMOL-V decoder adapted from aras-p/smol-v (MIT); see vendor/smol-v/LICENSE.
const ops: number[][] = [
  [0, 0, 0, 0], // Nop
  [1, 1, 0, 0], // Undef
  [0, 0, 0, 0], // SourceContinued
  [0, 0, 0, 1], // Source
  [0, 0, 0, 0], // SourceExtension
  [0, 0, 0, 0], // Name
  [0, 0, 0, 0], // MemberName
  [0, 0, 0, 0], // String
  [0, 0, 0, 1], // Line
  [1, 1, 0, 0], // #9
  [0, 0, 0, 0], // Extension
  [1, 0, 0, 0], // ExtInstImport
  [1, 1, 0, 1], // ExtInst
  [1, 1, 2, 1], // VectorShuffleCompact - new in SMOLV
  [0, 0, 0, 1], // MemoryModel
  [0, 0, 0, 1], // EntryPoint
  [0, 0, 0, 1], // ExecutionMode
  [0, 0, 0, 1], // Capability
  [1, 1, 0, 0], // #18
  [1, 0, 0, 1], // TypeVoid
  [1, 0, 0, 1], // TypeBool
  [1, 0, 0, 1], // TypeInt
  [1, 0, 0, 1], // TypeFloat
  [1, 0, 0, 1], // TypeVector
  [1, 0, 0, 1], // TypeMatrix
  [1, 0, 0, 1], // TypeImage
  [1, 0, 0, 1], // TypeSampler
  [1, 0, 0, 1], // TypeSampledImage
  [1, 0, 0, 1], // TypeArray
  [1, 0, 0, 1], // TypeRuntimeArray
  [1, 0, 0, 1], // TypeStruct
  [1, 0, 0, 1], // TypeOpaque
  [1, 0, 0, 1], // TypePointer
  [1, 0, 0, 1], // TypeFunction
  [1, 0, 0, 1], // TypeEvent
  [1, 0, 0, 1], // TypeDeviceEvent
  [1, 0, 0, 1], // TypeReserveId
  [1, 0, 0, 1], // TypeQueue
  [1, 0, 0, 1], // TypePipe
  [0, 0, 0, 1], // TypeForwardPointer
  [1, 1, 0, 0], // #40
  [1, 1, 0, 0], // ConstantTrue
  [1, 1, 0, 0], // ConstantFalse
  [1, 1, 0, 0], // Constant
  [1, 1, 9, 0], // ConstantComposite
  [1, 1, 0, 1], // ConstantSampler
  [1, 1, 0, 0], // ConstantNull
  [1, 1, 0, 0], // #47
  [1, 1, 0, 0], // SpecConstantTrue
  [1, 1, 0, 0], // SpecConstantFalse
  [1, 1, 0, 0], // SpecConstant
  [1, 1, 9, 0], // SpecConstantComposite
  [1, 1, 0, 0], // SpecConstantOp
  [1, 1, 0, 0], // #53
  [1, 1, 0, 1], // Function
  [1, 1, 0, 0], // FunctionParameter
  [0, 0, 0, 0], // FunctionEnd
  [1, 1, 9, 0], // FunctionCall
  [1, 1, 0, 0], // #58
  [1, 1, 0, 1], // Variable
  [1, 1, 0, 0], // ImageTexelPointer
  [1, 1, 1, 1], // Load
  [0, 0, 2, 1], // Store
  [0, 0, 0, 0], // CopyMemory
  [0, 0, 0, 0], // CopyMemorySized
  [1, 1, 0, 1], // AccessChain
  [1, 1, 0, 0], // InBoundsAccessChain
  [1, 1, 0, 0], // PtrAccessChain
  [1, 1, 0, 0], // ArrayLength
  [1, 1, 0, 0], // GenericPtrMemSemantics
  [1, 1, 0, 0], // InBoundsPtrAccessChain
  [0, 0, 0, 1], // Decorate
  [0, 0, 0, 1], // MemberDecorate
  [1, 0, 0, 0], // DecorationGroup
  [0, 0, 0, 0], // GroupDecorate
  [0, 0, 0, 0], // GroupMemberDecorate
  [1, 1, 0, 0], // #76
  [1, 1, 1, 1], // VectorExtractDynamic
  [1, 1, 2, 1], // VectorInsertDynamic
  [1, 1, 2, 1], // VectorShuffle
  [1, 1, 9, 0], // CompositeConstruct
  [1, 1, 1, 1], // CompositeExtract
  [1, 1, 2, 1], // CompositeInsert
  [1, 1, 1, 0], // CopyObject
  [1, 1, 0, 0], // Transpose
  [1, 1, 0, 0], // #85
  [1, 1, 0, 0], // SampledImage
  [1, 1, 2, 1], // ImageSampleImplicitLod
  [1, 1, 2, 1], // ImageSampleExplicitLod
  [1, 1, 3, 1], // ImageSampleDrefImplicitLod
  [1, 1, 3, 1], // ImageSampleDrefExplicitLod
  [1, 1, 2, 1], // ImageSampleProjImplicitLod
  [1, 1, 2, 1], // ImageSampleProjExplicitLod
  [1, 1, 3, 1], // ImageSampleProjDrefImplicitLod
  [1, 1, 3, 1], // ImageSampleProjDrefExplicitLod
  [1, 1, 2, 1], // ImageFetch
  [1, 1, 3, 1], // ImageGather
  [1, 1, 3, 1], // ImageDrefGather
  [1, 1, 2, 1], // ImageRead
  [0, 0, 3, 1], // ImageWrite
  [1, 1, 1, 0], // Image
  [1, 1, 1, 0], // ImageQueryFormat
  [1, 1, 1, 0], // ImageQueryOrder
  [1, 1, 2, 0], // ImageQuerySizeLod
  [1, 1, 1, 0], // ImageQuerySize
  [1, 1, 2, 0], // ImageQueryLod
  [1, 1, 1, 0], // ImageQueryLevels
  [1, 1, 1, 0], // ImageQuerySamples
  [1, 1, 0, 0], // #108
  [1, 1, 1, 0], // ConvertFToU
  [1, 1, 1, 0], // ConvertFToS
  [1, 1, 1, 0], // ConvertSToF
  [1, 1, 1, 0], // ConvertUToF
  [1, 1, 1, 0], // UConvert
  [1, 1, 1, 0], // SConvert
  [1, 1, 1, 0], // FConvert
  [1, 1, 1, 0], // QuantizeToF16
  [1, 1, 1, 0], // ConvertPtrToU
  [1, 1, 1, 0], // SatConvertSToU
  [1, 1, 1, 0], // SatConvertUToS
  [1, 1, 1, 0], // ConvertUToPtr
  [1, 1, 1, 0], // PtrCastToGeneric
  [1, 1, 1, 0], // GenericCastToPtr
  [1, 1, 1, 1], // GenericCastToPtrExplicit
  [1, 1, 1, 0], // Bitcast
  [1, 1, 0, 0], // #125
  [1, 1, 1, 0], // SNegate
  [1, 1, 1, 0], // FNegate
  [1, 1, 2, 0], // IAdd
  [1, 1, 2, 0], // FAdd
  [1, 1, 2, 0], // ISub
  [1, 1, 2, 0], // FSub
  [1, 1, 2, 0], // IMul
  [1, 1, 2, 0], // FMul
  [1, 1, 2, 0], // UDiv
  [1, 1, 2, 0], // SDiv
  [1, 1, 2, 0], // FDiv
  [1, 1, 2, 0], // UMod
  [1, 1, 2, 0], // SRem
  [1, 1, 2, 0], // SMod
  [1, 1, 2, 0], // FRem
  [1, 1, 2, 0], // FMod
  [1, 1, 2, 0], // VectorTimesScalar
  [1, 1, 2, 0], // MatrixTimesScalar
  [1, 1, 2, 0], // VectorTimesMatrix
  [1, 1, 2, 0], // MatrixTimesVector
  [1, 1, 2, 0], // MatrixTimesMatrix
  [1, 1, 2, 0], // OuterProduct
  [1, 1, 2, 0], // Dot
  [1, 1, 2, 0], // IAddCarry
  [1, 1, 2, 0], // ISubBorrow
  [1, 1, 2, 0], // UMulExtended
  [1, 1, 2, 0], // SMulExtended
  [1, 1, 0, 0], // #153
  [1, 1, 1, 0], // Any
  [1, 1, 1, 0], // All
  [1, 1, 1, 0], // IsNan
  [1, 1, 1, 0], // IsInf
  [1, 1, 1, 0], // IsFinite
  [1, 1, 1, 0], // IsNormal
  [1, 1, 1, 0], // SignBitSet
  [1, 1, 2, 0], // LessOrGreater
  [1, 1, 2, 0], // Ordered
  [1, 1, 2, 0], // Unordered
  [1, 1, 2, 0], // LogicalEqual
  [1, 1, 2, 0], // LogicalNotEqual
  [1, 1, 2, 0], // LogicalOr
  [1, 1, 2, 0], // LogicalAnd
  [1, 1, 1, 0], // LogicalNot
  [1, 1, 3, 0], // Select
  [1, 1, 2, 0], // IEqual
  [1, 1, 2, 0], // INotEqual
  [1, 1, 2, 0], // UGreaterThan
  [1, 1, 2, 0], // SGreaterThan
  [1, 1, 2, 0], // UGreaterThanEqual
  [1, 1, 2, 0], // SGreaterThanEqual
  [1, 1, 2, 0], // ULessThan
  [1, 1, 2, 0], // SLessThan
  [1, 1, 2, 0], // ULessThanEqual
  [1, 1, 2, 0], // SLessThanEqual
  [1, 1, 2, 0], // FOrdEqual
  [1, 1, 2, 0], // FUnordEqual
  [1, 1, 2, 0], // FOrdNotEqual
  [1, 1, 2, 0], // FUnordNotEqual
  [1, 1, 2, 0], // FOrdLessThan
  [1, 1, 2, 0], // FUnordLessThan
  [1, 1, 2, 0], // FOrdGreaterThan
  [1, 1, 2, 0], // FUnordGreaterThan
  [1, 1, 2, 0], // FOrdLessThanEqual
  [1, 1, 2, 0], // FUnordLessThanEqual
  [1, 1, 2, 0], // FOrdGreaterThanEqual
  [1, 1, 2, 0], // FUnordGreaterThanEqual
  [1, 1, 0, 0], // #192
  [1, 1, 0, 0], // #193
  [1, 1, 2, 0], // ShiftRightLogical
  [1, 1, 2, 0], // ShiftRightArithmetic
  [1, 1, 2, 0], // ShiftLeftLogical
  [1, 1, 2, 0], // BitwiseOr
  [1, 1, 2, 0], // BitwiseXor
  [1, 1, 2, 0], // BitwiseAnd
  [1, 1, 1, 0], // Not
  [1, 1, 4, 0], // BitFieldInsert
  [1, 1, 3, 0], // BitFieldSExtract
  [1, 1, 3, 0], // BitFieldUExtract
  [1, 1, 1, 0], // BitReverse
  [1, 1, 1, 0], // BitCount
  [1, 1, 0, 0], // #206
  [1, 1, 0, 0], // DPdx
  [1, 1, 0, 0], // DPdy
  [1, 1, 0, 0], // Fwidth
  [1, 1, 0, 0], // DPdxFine
  [1, 1, 0, 0], // DPdyFine
  [1, 1, 0, 0], // FwidthFine
  [1, 1, 0, 0], // DPdxCoarse
  [1, 1, 0, 0], // DPdyCoarse
  [1, 1, 0, 0], // FwidthCoarse
  [1, 1, 0, 0], // #216
  [1, 1, 0, 0], // #217
  [0, 0, 0, 0], // EmitVertex
  [0, 0, 0, 0], // EndPrimitive
  [0, 0, 0, 0], // EmitStreamVertex
  [0, 0, 0, 0], // EndStreamPrimitive
  [1, 1, 0, 0], // #222
  [1, 1, 0, 0], // #223
  [0, 0, 3, 0], // ControlBarrier
  [0, 0, 2, 0], // MemoryBarrier
  [1, 1, 0, 0], // #226
  [1, 1, 0, 0], // AtomicLoad
  [0, 0, 0, 0], // AtomicStore
  [1, 1, 0, 0], // AtomicExchange
  [1, 1, 0, 0], // AtomicCompareExchange
  [1, 1, 0, 0], // AtomicCompareExchangeWeak
  [1, 1, 0, 0], // AtomicIIncrement
  [1, 1, 0, 0], // AtomicIDecrement
  [1, 1, 0, 0], // AtomicIAdd
  [1, 1, 0, 0], // AtomicISub
  [1, 1, 0, 0], // AtomicSMin
  [1, 1, 0, 0], // AtomicUMin
  [1, 1, 0, 0], // AtomicSMax
  [1, 1, 0, 0], // AtomicUMax
  [1, 1, 0, 0], // AtomicAnd
  [1, 1, 0, 0], // AtomicOr
  [1, 1, 0, 0], // AtomicXor
  [1, 1, 0, 0], // #243
  [1, 1, 0, 0], // #244
  [1, 1, 0, 0], // Phi
  [0, 0, 2, 1], // LoopMerge
  [0, 0, 1, 1], // SelectionMerge
  [1, 0, 0, 0], // Label
  [0, 0, 1, 0], // Branch
  [0, 0, 3, 1], // BranchConditional
  [0, 0, 0, 0], // Switch
  [0, 0, 0, 0], // Kill
  [0, 0, 0, 0], // Return
  [0, 0, 0, 0], // ReturnValue
  [0, 0, 0, 0], // Unreachable
  [0, 0, 0, 0], // LifetimeStart
  [0, 0, 0, 0], // LifetimeStop
  [1, 1, 0, 0], // #258
  [1, 1, 0, 0], // GroupAsyncCopy
  [0, 0, 0, 0], // GroupWaitEvents
  [1, 1, 0, 0], // GroupAll
  [1, 1, 0, 0], // GroupAny
  [1, 1, 0, 0], // GroupBroadcast
  [1, 1, 0, 0], // GroupIAdd
  [1, 1, 0, 0], // GroupFAdd
  [1, 1, 0, 0], // GroupFMin
  [1, 1, 0, 0], // GroupUMin
  [1, 1, 0, 0], // GroupSMin
  [1, 1, 0, 0], // GroupFMax
  [1, 1, 0, 0], // GroupUMax
  [1, 1, 0, 0], // GroupSMax
  [1, 1, 0, 0], // #272
  [1, 1, 0, 0], // #273
  [1, 1, 0, 0], // ReadPipe
  [1, 1, 0, 0], // WritePipe
  [1, 1, 0, 0], // ReservedReadPipe
  [1, 1, 0, 0], // ReservedWritePipe
  [1, 1, 0, 0], // ReserveReadPipePackets
  [1, 1, 0, 0], // ReserveWritePipePackets
  [0, 0, 0, 0], // CommitReadPipe
  [0, 0, 0, 0], // CommitWritePipe
  [1, 1, 0, 0], // IsValidReserveId
  [1, 1, 0, 0], // GetNumPipePackets
  [1, 1, 0, 0], // GetMaxPipePackets
  [1, 1, 0, 0], // GroupReserveReadPipePackets
  [1, 1, 0, 0], // GroupReserveWritePipePackets
  [0, 0, 0, 0], // GroupCommitReadPipe
  [0, 0, 0, 0], // GroupCommitWritePipe
  [1, 1, 0, 0], // #289
  [1, 1, 0, 0], // #290
  [1, 1, 0, 0], // EnqueueMarker
  [1, 1, 0, 0], // EnqueueKernel
  [1, 1, 0, 0], // GetKernelNDrangeSubGroupCount
  [1, 1, 0, 0], // GetKernelNDrangeMaxSubGroupSize
  [1, 1, 0, 0], // GetKernelWorkGroupSize
  [1, 1, 0, 0], // GetKernelPreferredWorkGroupSizeMultiple
  [0, 0, 0, 0], // RetainEvent
  [0, 0, 0, 0], // ReleaseEvent
  [1, 1, 0, 0], // CreateUserEvent
  [1, 1, 0, 0], // IsValidEvent
  [0, 0, 0, 0], // SetUserEventStatus
  [0, 0, 0, 0], // CaptureEventProfilingInfo
  [1, 1, 0, 0], // GetDefaultQueue
  [1, 1, 0, 0], // BuildNDRange
  [1, 1, 2, 1], // ImageSparseSampleImplicitLod
  [1, 1, 2, 1], // ImageSparseSampleExplicitLod
  [1, 1, 3, 1], // ImageSparseSampleDrefImplicitLod
  [1, 1, 3, 1], // ImageSparseSampleDrefExplicitLod
  [1, 1, 2, 1], // ImageSparseSampleProjImplicitLod
  [1, 1, 2, 1], // ImageSparseSampleProjExplicitLod
  [1, 1, 3, 1], // ImageSparseSampleProjDrefImplicitLod
  [1, 1, 3, 1], // ImageSparseSampleProjDrefExplicitLod
  [1, 1, 2, 1], // ImageSparseFetch
  [1, 1, 3, 1], // ImageSparseGather
  [1, 1, 3, 1], // ImageSparseDrefGather
  [1, 1, 1, 0], // ImageSparseTexelsResident
  [0, 0, 0, 0], // NoLine
  [1, 1, 0, 0], // AtomicFlagTestAndSet
  [0, 0, 0, 0], // AtomicFlagClear
  [1, 1, 0, 0], // ImageSparseRead
  [1, 1, 0, 0], // SizeOf
  [1, 1, 0, 0], // TypePipeStorage
  [1, 1, 0, 0], // ConstantPipeStorage
  [1, 1, 0, 0], // CreatePipeFromPipeStorage
  [1, 1, 0, 0], // GetKernelLocalSizeForSubgroupCount
  [1, 1, 0, 0], // GetKernelMaxNumSubgroups
  [1, 1, 0, 0], // TypeNamedBarrier
  [1, 1, 0, 1], // NamedBarrierInitialize
  [0, 0, 2, 1], // MemoryNamedBarrier
  [1, 1, 0, 0], // ModuleProcessed
  [0, 0, 0, 1], // ExecutionModeId
  [0, 0, 0, 1], // DecorateId
  [1, 1, 1, 1], // GroupNonUniformElect
  [1, 1, 1, 1], // GroupNonUniformAll
  [1, 1, 1, 1], // GroupNonUniformAny
  [1, 1, 1, 1], // GroupNonUniformAllEqual
  [1, 1, 1, 1], // GroupNonUniformBroadcast
  [1, 1, 1, 1], // GroupNonUniformBroadcastFirst
  [1, 1, 1, 1], // GroupNonUniformBallot
  [1, 1, 1, 1], // GroupNonUniformInverseBallot
  [1, 1, 1, 1], // GroupNonUniformBallotBitExtract
  [1, 1, 1, 1], // GroupNonUniformBallotBitCount
  [1, 1, 1, 1], // GroupNonUniformBallotFindLSB
  [1, 1, 1, 1], // GroupNonUniformBallotFindMSB
  [1, 1, 1, 1], // GroupNonUniformShuffle
  [1, 1, 1, 1], // GroupNonUniformShuffleXor
  [1, 1, 1, 1], // GroupNonUniformShuffleUp
  [1, 1, 1, 1], // GroupNonUniformShuffleDown
  [1, 1, 1, 1], // GroupNonUniformIAdd
  [1, 1, 1, 1], // GroupNonUniformFAdd
  [1, 1, 1, 1], // GroupNonUniformIMul
  [1, 1, 1, 1], // GroupNonUniformFMul
  [1, 1, 1, 1], // GroupNonUniformSMin
  [1, 1, 1, 1], // GroupNonUniformUMin
  [1, 1, 1, 1], // GroupNonUniformFMin
  [1, 1, 1, 1], // GroupNonUniformSMax
  [1, 1, 1, 1], // GroupNonUniformUMax
  [1, 1, 1, 1], // GroupNonUniformFMax
  [1, 1, 1, 1], // GroupNonUniformBitwiseAnd
  [1, 1, 1, 1], // GroupNonUniformBitwiseOr
  [1, 1, 1, 1], // GroupNonUniformBitwiseXor
  [1, 1, 1, 1], // GroupNonUniformLogicalAnd
  [1, 1, 1, 1], // GroupNonUniformLogicalOr
  [1, 1, 1, 1], // GroupNonUniformLogicalXor
  [1, 1, 1, 1], // GroupNonUniformQuadBroadcast
  [1, 1, 1, 1], // GroupNonUniformQuadSwap
];
/** Decode a Unity SMOL-V program, validating lengths before allocating/writing. */
export function decodeSmolv(input: Uint8Array, beforeZero = false): Uint8Array {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length < 24 || b.readUInt32LE(0) !== 0x534d4f4c)
    throw Error("Invalid SMOL-V header");
  const headerVersion = b.readUInt32LE(4),
    version = headerVersion & 0xffffff;
  const encoding = headerVersion >>> 24,
    size = b.readUInt32LE(20);
  beforeZero = beforeZero && encoding === 0;
  const knownOps = encoding === 0 ? 331 : 367;
  if (
    version < 0x10000 ||
    version > 0x10600 ||
    encoding > 1 ||
    size < 20 ||
    size > 64 * 1024 ** 2 ||
    size % 4
  )
    throw Error("Invalid SMOL-V version or decoded size");
  const out = Buffer.alloc(size);
  b.copy(out, 0, 0, 20);
  out.writeUInt32LE(0x07230203, 0);
  out.writeUInt32LE(version, 4);
  let pos = 24,
    dest = 20,
    prevResult = 0,
    prevDecorate = 0;
  const byte = () => {
    if (pos >= b.length) throw Error("Truncated SMOL-V");
    return b[pos++];
  };
  const word = () => {
    if (pos + 4 > b.length) throw Error("Truncated SMOL-V word");
    const v = b.readUInt32LE(pos);
    pos += 4;
    return v;
  };
  const write = (v: number) => {
    if (dest + 4 > size) throw Error("SMOL-V output overflow");
    out.writeUInt32LE(v >>> 0, dest);
    dest += 4;
  };
  const variable = () => {
    let v = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const n = byte();
      if (shift === 28 && n & 0xf0) throw Error("SMOL-V varint overflow");
      v |= (n & 127) << shift;
      if (!(n & 128)) return v >>> 0;
    }
    throw Error("Invalid SMOL-V varint");
  };
  const zig = (v: number) => (v >>> 1) ^ -(v & 1);
  const swaps: Record<number, number> = {
    0: 71,
    1: 61,
    2: 62,
    3: 65,
    4: 79,
    7: 72,
    8: 248,
    9: 59,
    10: 133,
    11: 129,
    14: 32,
    15: 127,
  };
  for (const [a, v] of Object.entries({ ...swaps })) swaps[v] = Number(a);
  while (pos < b.length) {
    const packed = variable();
    let len = ((packed >>> 20) << 4) | ((packed >>> 4) & 15);
    let op = ((packed >>> 4) & 0xfff0) | (packed & 15);
    op = swaps[op] ?? op;
    len +=
      1 +
      ([79, 13].includes(op)
        ? 4
        : [61, 65].includes(op)
          ? 3
          : op === 71
            ? 2
            : 0);
    const compact = op === 13;
    if (compact) op = 79;
    if (len > 65535 || dest + len * 4 > size)
      throw Error("Invalid SMOL-V instruction length");
    const end = dest + len * 4;
    write((len << 16) | op);
    const [hasResult, hasType, delta, varrest] = (op < knownOps
      ? ops[op]
      : undefined) ?? [0, 0, 0, 0];
    let used = 1;
    if (hasType) {
      write(variable());
      used++;
    }
    if (hasResult) {
      prevResult = (prevResult + zig(variable())) | 0;
      write(prevResult);
      used++;
    }
    if (op === 71 || op === 72) {
      const v = variable();
      prevDecorate = (prevDecorate + (beforeZero ? v : zig(v))) | 0;
      write(prevDecorate);
      used++;
    }
    if (op === 72 && !beforeZero) {
      const count = byte();
      if (!count) throw Error("Empty SMOL-V member decoration group");
      let previousIndex = 0,
        previousOffset = 0;
      for (let m = 0; m < count; m++) {
        const index = (previousIndex + variable()) >>> 0;
        previousIndex = index;
        const decoration = variable();
        const extra =
          decoration === 0 || (decoration >= 2 && decoration <= 5)
            ? 0
            : decoration >= 29 && decoration <= 37
              ? 1
              : -1;
        const memberLength = 4 + (extra < 0 ? variable() : extra);
        if (memberLength > 65535 || (m === 0 && memberLength !== len))
          throw Error("Invalid SMOL-V member decoration length");
        if (m) {
          write((memberLength << 16) | op);
          write(prevDecorate);
        }
        write(index);
        write(decoration);
        if (decoration === 35) {
          previousOffset = (previousOffset + variable()) >>> 0;
          write(previousOffset);
        } else for (let j = 4; j < memberLength; j++) write(variable());
      }
      continue;
    }
    const zigIDs =
      !beforeZero || [224, 225, 246, 247, 249, 250, 329].includes(op);
    for (let i = 0; i < Math.abs(delta) && used < len; i++, used++) {
      const v = variable();
      write(prevResult - (zigIDs ? zig(v) : v));
    }
    if (compact && len <= 9) {
      const v = byte();
      for (let i = 5; i < len; i++) write((v >> ((8 - i) * 2)) & 3);
    } else for (; used < len; used++) write(varrest ? variable() : word());
    if (dest !== end) throw Error("Malformed SMOL-V instruction");
  }
  if (dest !== size) throw Error("SMOL-V decoded size mismatch");
  return out;
}
