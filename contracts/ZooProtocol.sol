// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./interfaces/IUsd.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IZooProtocol.sol";
import "./settings/ProtocolSettings.sol";

contract ZooProtocol is IZooProtocol, Ownable, ReentrancyGuard {
  using EnumerableSet for EnumerableSet.AddressSet;

  address internal _usdToken;

  EnumerableSet.AddressSet internal _assetTokens;
  EnumerableSet.AddressSet internal _vaults;
  mapping(address => EnumerableSet.AddressSet) _assetTokenToVaults;

  bool public initialized;

  constructor() {}

  /* ========== Views ========= */

  function protocolOwner() public view returns (address) {
    return owner();
  }

  function usdToken() public view override returns (address) {
    return _usdToken;
  }

  /* ========== RESTRICTED FUNCTIONS ========= */

  function initialize(address _usdToken_) external nonReentrant onlyOwner {
    require(!initialized, "Already initialized");
    require(_usdToken_ != address(0), "Zero address detected");

    _usdToken = _usdToken_;

    initialized = true;
    emit Initialized();
  }

  /* ========== Vault Operations ========== */

  function addVault(address vault) external nonReentrant onlyOwner onlyInitialized {
    require(!_vaults.contains(vault), "Vault already added");
    _vaults.add(vault);

    address assetToken = IVault(vault).assetToken();
    if (!_assetTokens.contains(assetToken)) {
      _assetTokens.add(assetToken);
    }

    EnumerableSet.AddressSet storage tokenVaults = _assetTokenToVaults[assetToken];
    if (!tokenVaults.contains(vault)) {
      tokenVaults.add(vault);
    }

    emit VaultAdded(assetToken, vault);
  }

  function assetTokens() external view returns (address[] memory) {
    return _assetTokens.values();
  }

  function isVault(address vaultAddress) external view override returns (bool) {
    require(vaultAddress != address(0), "Zero address detected");
    return _vaults.contains(vaultAddress);
  }

  function isVaultAsset(address assetToken) external view override returns (bool) {
    require(assetToken != address(0), "Zero address detected");
    return _assetTokens.contains(assetToken);
  }

  function getVaultAddresses(address assetToken) external view returns (address[] memory) {
    require(assetToken != address(0) && _assetTokens.contains(assetToken), "Invalid asset token");
    return _assetTokenToVaults[assetToken].values();
  }

  /* ============== MODIFIERS =============== */

  modifier onlyInitialized() {
    require(initialized, "Not initialized yet");
    _;
  }

  /* =============== EVENTS ============= */

  event Initialized();

  event VaultAdded(address indexed assetToken, address vault);
}