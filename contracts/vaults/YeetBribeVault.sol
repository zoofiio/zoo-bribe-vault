// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "../interfaces/IYeetTrifectaVault.sol";
import "./Vault.sol";

contract YeetBribeVault is Vault {
  using Math for uint256;

  IYeetTrifectaVault public trifectaVault;
  uint256 public accumulatedAssetAmount;

  constructor(
    address _protocol,
    address _settings,
    address _redeemPoolFactory,
    address _bribesPoolFactory,
    address _trifectaVault_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) Vault(_protocol, _settings, _redeemPoolFactory, _bribesPoolFactory, _assetToken_, _pTokenName, _pTokensymbol) {
    require(_trifectaVault_ != address(0), "Zero address detected");
    
    trifectaVault = IYeetTrifectaVault(trifectaVault);
    _assetToken.approve(address(trifectaVault), type(uint256).max);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  /**
   * @dev Returns how many $WBERA-$YEET LPs could be withdrawn from Trifecta Vault
   */
  function _balanceOfUnderlyingVault() internal view override returns (uint256) {
    uint256 shares = trifectaVault.balanceOf(address(this));
    return trifectaVault.previewRedeem(shares);
  }

  /**
   * @dev Deposit $WBERA-$YEET LPs to Trifecta Vault
   * @param amount Amount of $WBERA-$YEET LPs to deposit
   */
  function _depositToUnderlyingVault(uint256 amount) internal override {
    trifectaVault.deposit(amount, address(this));
    accumulatedAssetAmount = accumulatedAssetAmount + amount;
  }

  /**
   * @dev Withdraw $WBERA-$YEET LPs from Trifecta Vault
   * @param amount Amount of $WBERA-$YEET LPs to withdraw
   */
  function _withdrawFromUnderlyingVault(uint256 amount) internal override {
    trifectaVault.withdraw(amount, address(this), address(this));
    accumulatedAssetAmount = accumulatedAssetAmount - amount;
  }

  /**
   * @dev Withdraw all $WBERA-$YEET LPs from Trifecta Vault
   */
  function _exitUnderlyingVault() internal override {
    uint256 shares = trifectaVault.balanceOf(address(this));
    trifectaVault.redeem(shares, address(this), address(this));
    accumulatedAssetAmount = 0;
  }

  function _getRewardsFromUnderlyingVault(IBribesPool stakingBribesPool) internal override {
    uint256 prevAssetBalance = _assetToken.balanceOf(address(this));

    uint256 yields = 0;
    uint256 assetAmountWithYields = _balanceOfUnderlyingVault();
    if (assetAmountWithYields > accumulatedAssetAmount) {
      yields = assetAmountWithYields - accumulatedAssetAmount;
    }

    if (yields > 0) {
      uint256 bpsScale = trifectaVault._BASIS_POINT_SCALE();
      uint256 bps = trifectaVault.maxAllowedFeeBps();
      uint256 withdrawAmount = yields.mulDiv(
        bpsScale,
        bpsScale + bps * bpsScale
      );
      trifectaVault.withdraw(withdrawAmount, address(this), address(this));
    }

    uint256 actualYields = _assetToken.balanceOf(address(this)) - prevAssetBalance;
    if (actualYields > 0) {
      IERC20(address(_assetToken)).approve(address(stakingBribesPool), actualYields);
      stakingBribesPool.addBribes(address(_assetToken), actualYields);
    }
  }

}