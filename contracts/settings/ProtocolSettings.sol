// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "hardhat/console.sol";

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../interfaces/IProtocolSettings.sol";
import "../libs/Constants.sol";
import "./ProtocolOwner.sol";

contract ProtocolSettings is IProtocolSettings, ProtocolOwner, ReentrancyGuard {
  using EnumerableSet for EnumerableSet.Bytes32Set;

  address internal _treasury;

  struct ParamConfig {
    uint256 defaultValue;
    uint256 min;
    uint256 max;
  }

  EnumerableSet.Bytes32Set internal _paramsSet;
  mapping(bytes32 => ParamConfig) internal _paramConfigs;

  mapping(address => mapping(bytes32 => bool)) internal _vaultParamsSet;
  mapping(address => mapping(bytes32 => uint256)) internal _vaultParams;

  constructor(address _protocol_, address _treasury_) ProtocolOwner(_protocol_) {
    _treasury = _treasury_;

    // Redemption fee rate. Default to 0.5%. [0, 10%]
    _upsertParamConfig("C", 5 * 10 ** 7, 0, 10 ** 9);
    // Treasury fee rate. Default to 50%. [0, 100%]
    _upsertParamConfig("TreasuryFeeRate", 5 * 10 ** 9, 0, 10 ** 10);
    _upsertParamConfig("PtyPoolBuyLowFeeRate", 5 * 10 ** 9, 0, 10 ** 10);
    _upsertParamConfig("PtyPoolBuyLowMarginYieldsRate", 5 * 10 ** 9, 0, 10 ** 10);
    // Yield rate. Default to 3.5%, [0, 50%]
    _upsertParamConfig("Y", 35 * 10 ** 7, 0, 5 * 10 ** 9);
    // Rate of r change per hour. Default to 0.001, [0, 1]
    _upsertParamConfig("RateR", 10 ** 7, 0, 10 ** 10);
    // Circuit breaker period. Default to 1 hour, [1 minute, 1 day]
    _upsertParamConfig("CircuitBreakPeriod", 1 hours, 1 minutes, 1 days);
    // Target AAR. Default 150%, [100%, 1000%]
    _upsertParamConfig("AART", 15 * 10 ** 9, 10 ** 10, 10 ** 11);
    // Safe AAR. Default 130%, [100%, 1000%]
    _upsertParamConfig("AARS", 13 * 10 ** 9, 10 ** 10, 10 ** 11);
    // Upper AAR. Default 200%, [100%, 1000%]
    _upsertParamConfig("AARU", 2 * 10 ** 10, 10 ** 10, 10 ** 11);
    // Circuit Breaker AAR. Default 110%, [100%, 1000%]
    _upsertParamConfig("AARC", 11 * 10 ** 9, 10 ** 10, 10 ** 11);
    // Price Trigger Yield pool, min $zUSD dust amount. Default 1000 $zUSD, [0, 1000000]
    _upsertParamConfig("PtyPoolMinUsdAmount", 1000 * 10 ** 10, 0, 1000000 * 10 ** 10);
    // Price Trigger Yield pool, min asset dust amount. Default 0.1, [0, 1000000]
    _upsertParamConfig("PtyPoolMinAssetAmount", 10 ** 9, 0, 1000000 * 10 ** 10);
  }

  /* ============== VIEWS =============== */

  function treasury() public view override returns (address) {
    return _treasury;
  }

  function decimals() public pure returns (uint256) {
    return Constants.PROTOCOL_DECIMALS;
  }

  function params() public view returns (bytes32[] memory) {
    return _paramsSet.values();
  }

  function isValidParam(bytes32 param, uint256 value) public view returns (bool) {
    if (param.length == 0 || !_paramsSet.contains(param)) {
      return false;
    }

    ParamConfig memory config = _paramConfigs[param];
    return config.min <= value && value <= config.max;
  }

  function paramConfig(bytes32 param) public view returns(ParamConfig memory) {
    require(param.length > 0, "Empty param name");
    require(_paramsSet.contains(param), "Invalid param name");
    return _paramConfigs[param];
  }

  function paramDefaultValue(bytes32 param) public view returns (uint256) {
    require(param.length > 0, "Empty param name");
    require(_paramsSet.contains(param), "Invalid param name");
    return paramConfig(param).defaultValue;
  }

  function vaultParamValue(address vault, bytes32 param) public view returns (uint256) {
    require(protocol.isVault(vault), "Invalid vault");
    require(param.length > 0, "Empty param name");

    if (_vaultParamsSet[vault][param]) {
      return _vaultParams[vault][param];
    }
    return paramDefaultValue(param);
  }

  /* ============ MUTATIVE FUNCTIONS =========== */

  function setTreasury(address newTreasury) external nonReentrant onlyOwner {
    require(newTreasury != address(0), "Zero address detected");
    require(newTreasury != _treasury, "Same treasury");

    address prevTreasury = _treasury;
    _treasury = newTreasury;
    emit UpdateTreasury(prevTreasury, _treasury);
  }

  function upsertParamConfig(bytes32 param, uint256 defaultValue, uint256 min, uint256 max) external nonReentrant onlyOwner {
    _upsertParamConfig(param, defaultValue, min, max);
  }

  function _upsertParamConfig(bytes32 param, uint256 defaultValue, uint256 min, uint256 max) internal {
    require(param.length > 0, "Empty param name");
    require(min <= defaultValue && defaultValue <= max, "Invalid default value");

    if (_paramsSet.contains(param)) {
      ParamConfig storage config = _paramConfigs[param];
      config.defaultValue = defaultValue;
      config.min = min;
      config.max = max;
    }
    else {
      _paramsSet.add(param);
      _paramConfigs[param] = ParamConfig(defaultValue, min, max);
    }
    emit UpsertParamConfig(param, defaultValue, min, max);
  }

  function updateVaultParamValue(address vault, bytes32 param, uint256 value) external nonReentrant onlyOwner {
    require(protocol.isVault(vault), "Invalid vault");
    require(isValidParam(param, value), "Invalid param or value");

    _vaultParamsSet[vault][param] = true;
    _vaultParams[vault][param] = value;
    emit UpdateVaultParamValue(vault, param, value);
  }

  /* =============== EVENTS ============= */

  event UpdateTreasury(address prevTreasury, address newTreasury);

  event UpsertParamConfig(bytes32 indexed name, uint256 defaultValue, uint256 min, uint256 max);

  event UpdateVaultParamValue(address indexed vault, bytes32 indexed param, uint256 value);

}