# Nimbus
# Copyright (c) 2018 Status Research & Development GmbH
# Licensed under either of
#  * Apache License, version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
#  * MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
# at your option. This file may not be copied, modified, or distributed except according to those terms.

import
  os, macros, json, strformat, strutils, parseutils, ospaths, tables,
  stew/byteutils, stew/ranges/typedranges, net, eth/[common, keys, rlp, p2p],
  ../nimbus/[vm_state, constants, config, transaction, utils, errors],
  ../nimbus/db/[db_chain, state_db],
  ../nimbus/vm/interpreter/[gas_costs, vm_forks],
  ../tests/test_generalstate_failing

func revmap(x: Table[Fork, string]): Table[string, Fork] =
  result = initTable[string, Fork]()
  for k, v in x:
    result[v] = k

const
  # from https://ethereum-tests.readthedocs.io/en/latest/test_types/state_tests.html
  forkNames* = {
    FkFrontier: "Frontier",
    FkHomestead: "Homestead",
    FkTangerine: "EIP150",
    FkSpurious: "EIP158",
    FkByzantium: "Byzantium",
    FkConstantinople: "ConstantinopleFix"
  }.toTable

  supportedForks* = {FkFrontier, FkHomestead, FkTangerine, FkSpurious, FkByzantium, FkConstantinople}

  nameToFork* = revmap(forkNames)

type
  Status* {.pure.} = enum OK, Fail, Skip

func slowTest*(folder: string, name: string): bool =
  result =
    (folder == "vmPerformance" and "loop" in name) or
    folder == "stQuadraticComplexityTest" or
    name in @["randomStatetest352.json", "randomStatetest1.json",
             "randomStatetest32.json", "randomStatetest347.json",
             "randomStatetest393.json", "randomStatetest626.json",
             "CALLCODE_Bounds.json", "DELEGATECALL_Bounds3.json",
             "CALLCODE_Bounds4.json", "CALL_Bounds.json",
             "DELEGATECALL_Bounds2.json", "CALL_Bounds3.json",
             "CALLCODE_Bounds2.json", "CALLCODE_Bounds3.json",
             "DELEGATECALL_Bounds.json", "CALL_Bounds2a.json",
             "CALL_Bounds2.json",
             "CallToNameRegistratorMemOOGAndInsufficientBalance.json",
             "CallToNameRegistratorTooMuchMemory0.json",

              # all these tests below actually pass
              # but they are very slow

              # constantinople slow tests
              "Create2Recursive.json",

              # byzantium slow tests
              "LoopCallsDepthThenRevert3.json",
              "LoopCallsDepthThenRevert2.json",
              "LoopCallsDepthThenRevert.json",
              "static_Call50000.json",
              "static_Call50000_ecrec.json",
              "static_Call50000_identity.json",
              "static_Call50000_identity2.json",
              "static_Call50000_rip160.json",
              "static_Call50000_sha256.json",
              "LoopCallsThenRevert.json",
              "LoopDelegateCallsDepthThenRevert.json",
              "recursiveCreateReturnValue.json",
              "static_Call1024PreCalls2.json",
              "Callcode1024BalanceTooLow.json",
              "static_Call1024BalanceTooLow.json",
              "static_Call1024BalanceTooLow2.json",
              "static_Call1024OOG.json",
              "static_Call1024PreCalls3.json",
              "static_Call1024PreCalls.json",
              "static_Call1MB1024Calldepth.json",

              # Homestead recursives
              "ContractCreationSpam.json",
              "Call1024OOG.json",
              "Call1024PreCalls.json",
              "CallRecursiveBombPreCall.json",
              "Delegatecall1024.json",
              "Delegatecall1024OOG.json",
              "JUMPDEST_Attack.json",
              "JUMPDEST_AttackwithJump.json",
              "ABAcalls1.json",
              "ABAcalls2.json",
              "CallRecursiveBomb0.json",
              "CallRecursiveBomb0_OOG_atMaxCallDepth.json",
              "CallRecursiveBomb1.json",
              "CallRecursiveBomb2.json",
              "CallRecursiveBombLog.json",
              "CallRecursiveBombLog2.json",
              "Call1024BalanceTooLow.json",

              # Frontier recursives
              "Callcode1024OOG.json",
              "callcallcodecall_ABCB_RECURSIVE.json",
              "callcallcodecallcode_ABCB_RECURSIVE.json",
              "callcodecallcall_ABCB_RECURSIVE.json",
              "callcodecallcallcode_ABCB_RECURSIVE.json",
              "callcodecallcodecall_ABCB_RECURSIVE.json",
              "callcodecallcodecallcode_ABCB_RECURSIVE.json",
              "callcallcallcode_ABCB_RECURSIVE.json",

              # BlockChain slow tests
              "SuicideIssue.json"
              ]

func failIn32Bits(folder, name: string): bool =
  return name in @[
    "sha3_bigSize.json", # from vm_test

    # crash with OOM
    "static_Return50000_2.json",
    "randomStatetest185.json",
    "randomStatetest159.json",
    "randomStatetest48.json",

    # OOM in AppVeyor, not on my machine
    "randomStatetest36.json",

    # from test_transaction_json
    "RLPHeaderSizeOverflowInt32.json"
  ]

func allowedFailInCurrentBuild(folder, name: string): bool =
  when sizeof(int) == 4:
    if failIn32Bits(folder, name):
      return true
  return allowedFailingGeneralStateTest(folder, name)

func validTest*(folder: string, name: string): bool =
  # we skip tests that are slow or expected to fail for now
  result =
    not slowTest(folder, name) and
    not allowedFailInCurrentBuild(folder, name)

proc lacksSupportedForks*(fixtures: JsonNode): bool =
  # XXX: Until Nimbus supports Byzantine or newer forks, as opposed
  # to Homestead, ~1k of ~2.5k GeneralStateTests won't work.

  var fixture: JsonNode
  for label, child in fixtures:
    fixture = child
    break

  # not all fixtures make a distinction between forks, so default to accepting
  # them all, until we find the ones that specify forks in their "post" section
  result = false
  if fixture.kind == JObject and fixture.hasKey("transaction") and fixture.hasKey("post"):
    result = true
    for fork in supportedForks:
      if fixture["post"].hasKey(forkNames[fork]):
        result = false
        break

macro jsonTest*(s: static[string], handler: untyped): untyped =
  let
    testStatusIMPL = ident("testStatusIMPL")
    # workaround for strformat in quote do: https://github.com/nim-lang/Nim/issues/8220
    symbol = newIdentNode"symbol"
    final  = newIdentNode"final"
    name   = newIdentNode"name"
    formatted = newStrLitNode"{symbol[final]} {name:<64}{$final}{'\n'}"

  result = quote:
    var filenames: seq[(string, string, string)] = @[]
    var status = initOrderedTable[string, OrderedTable[string, Status]]()
    for filename in walkDirRec("tests" / "fixtures" / `s`):
      if not filename.endsWith(".json"):
        continue
      var (folder, name) = filename.splitPath()
      let last = folder.splitPath().tail
      if not status.hasKey(last):
        status[last] = initOrderedTable[string, Status]()
      status[last][name] = Status.Skip
      if last.validTest(name):
        filenames.add((filename, last, name))
    for child in filenames:
      let (filename, folder, name) = child
      # we set this here because exceptions might be raised in the handler:
      status[folder][name] = Status.Fail
      let fixtures = parseJSON(readFile(filename))
      if fixtures.lacksSupportedForks:
        status[folder][name] = Status.Skip
        continue
      test filename:
        echo folder / name
        `handler`(fixtures, `testStatusIMPL`)
        if `testStatusIMPL` == OK:
          status[folder][name] = Status.OK

    status.sort do (a: (string, OrderedTable[string, Status]),
                    b: (string, OrderedTable[string, Status])) -> int: cmp(a[0], b[0])

    let `symbol`: array[Status, string] = ["+", "-", " "]
    var raw = ""
    var okCountTotal = 0
    var failCountTotal = 0
    var skipCountTotal = 0
    raw.add(`s` & "\n")
    raw.add("===\n")
    for folder, statuses in status:
      raw.add("## " & folder & "\n")
      raw.add("```diff\n")
      var sortedStatuses = statuses
      sortedStatuses.sort do (a: (string, Status), b: (string, Status)) -> int:
        cmp(a[0], b[0])
      var okCount = 0
      var failCount = 0
      var skipCount = 0
      for `name`, `final` in sortedStatuses:
        raw.add(&`formatted`)
        case `final`:
          of Status.OK: okCount += 1
          of Status.Fail: failCount += 1
          of Status.Skip: skipCount += 1
      raw.add("```\n")
      let sum = okCount + failCount + skipCount
      okCountTotal += okCount
      failCountTotal += failCount
      skipCountTotal += skipCount
      raw.add("OK: " & $okCount & "/" & $sum & " Fail: " & $failCount & "/" & $sum & " Skip: " & $skipCount & "/" & $sum & "\n")

    let sumTotal = okCountTotal + failCountTotal + skipCountTotal
    raw.add("\n---TOTAL---\n")
    raw.add("OK: $1/$4 Fail: $2/$4 Skip: $3/$4\n" % [$okCountTotal, $failCountTotal, $skipCountTotal, $sumTotal])
    writeFile(`s` & ".md", raw)

func ethAddressFromHex*(s: string): EthAddress = hexToByteArray(s, result)

func safeHexToSeqByte*(hexStr: string): seq[byte] =
  if hexStr == "":
    @[]
  else:
    hexStr.hexToSeqByte

func getHexadecimalInt*(j: JsonNode): int64 =
  # parseutils.parseHex works with int which will overflow in 32 bit
  var data: StUInt[64]
  data = fromHex(StUInt[64], j.getStr)
  result = cast[int64](data)

proc setupStateDB*(wantedState: JsonNode, stateDB: var AccountStateDB) =
  for ac, accountData in wantedState:
    let account = ethAddressFromHex(ac)
    for slot, value in accountData{"storage"}:
      stateDB.setStorage(account, fromHex(UInt256, slot), fromHex(UInt256, value.getStr))

    let nonce = accountData{"nonce"}.getHexadecimalInt.AccountNonce
    let code = accountData{"code"}.getStr.safeHexToSeqByte.toRange
    let balance = UInt256.fromHex accountData{"balance"}.getStr

    stateDB.setNonce(account, nonce)
    stateDB.setCode(account, code)
    stateDB.setBalance(account, balance)

proc verifyStateDB*(wantedState: JsonNode, stateDB: ReadOnlyStateDB) =
  for ac, accountData in wantedState:
    let account = ethAddressFromHex(ac)
    for slot, value in accountData{"storage"}:
      let
        slotId = UInt256.fromHex slot
        wantedValue = UInt256.fromHex value.getStr

      let (actualValue, found) = stateDB.getStorage(account, slotId)
      if not found:
        raise newException(ValidationError, "account not found:  " & ac)
      if actualValue != wantedValue:
        raise newException(ValidationError, &"{ac} storageDiff: [{slot}] {actualValue.toHex} != {wantedValue.toHex}")

    let
      wantedCode = hexToSeqByte(accountData{"code"}.getStr).toRange
      wantedBalance = UInt256.fromHex accountData{"balance"}.getStr
      wantedNonce = accountData{"nonce"}.getHexadecimalInt.AccountNonce

      actualCode = stateDB.getCode(account)
      actualBalance = stateDB.getBalance(account)
      actualNonce = stateDB.getNonce(account)

    if wantedCode != actualCode:
      raise newException(ValidationError, &"{ac} codeDiff {wantedCode} != {actualCode}")
    if wantedBalance != actualBalance:
      raise newException(ValidationError, &"{ac} balanceDiff {wantedBalance.toHex} != {actualBalance.toHex}")
    if wantedNonce != actualNonce:
      raise newException(ValidationError, &"{ac} nonceDiff {wantedNonce.toHex} != {actualNonce.toHex}")

proc getFixtureTransaction*(j: JsonNode, dataIndex, gasIndex, valueIndex: int): Transaction =
  result.accountNonce = j["nonce"].getHexadecimalInt.AccountNonce
  result.gasPrice = j["gasPrice"].getHexadecimalInt
  result.gasLimit = j["gasLimit"][gasIndex].getHexadecimalInt

  # TODO: there are a couple fixtures which appear to distinguish between
  # empty and 0 transaction.to; check/verify whether correct conditions.
  let rawTo = j["to"].getStr
  if rawTo == "":
    result.to = "0x".parseAddress
    result.isContractCreation = true
  else:
    result.to = rawTo.parseAddress
    result.isContractCreation = false
  result.value = fromHex(UInt256, j["value"][valueIndex].getStr)
  result.payload = j["data"][dataIndex].getStr.safeHexToSeqByte

  var secretKey = j["secretKey"].getStr
  removePrefix(secretKey, "0x")
  let privateKey = initPrivateKey(secretKey)
  let sig = signMessage(privateKey, result.rlpEncode)
  let raw = sig.getRaw()

  result.R = fromBytesBE(Uint256, raw[0..31])
  result.S = fromBytesBE(Uint256, raw[32..63])
  result.V = raw[64] + 27.byte

proc hashLogEntries*(logs: seq[Log]): string =
  toLowerAscii("0x" & $keccakHash(rlp.encode(logs)))

proc setupEthNode*(capabilities: varargs[ProtocolInfo, `protocolInfo`]): EthereumNode =
  var
    conf = getConfiguration()
    keypair: KeyPair
  keypair.seckey = conf.net.nodekey
  keypair.pubkey = conf.net.nodekey.getPublicKey()

  var srvAddress: Address
  srvAddress.ip = parseIpAddress("0.0.0.0")
  srvAddress.tcpPort = Port(conf.net.bindPort)
  srvAddress.udpPort = Port(conf.net.discPort)
  result = newEthereumNode(keypair, srvAddress, conf.net.networkId,
                              nil, "nimbus 0.1.0", addAllCapabilities = false)
  for capability in capabilities:
    result.addCapability capability