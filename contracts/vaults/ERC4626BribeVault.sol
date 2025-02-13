// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

import "../vaults/Vault.sol";

contract ERC4626BribeVault is Vault {
  using Math for uint256;

  IERC4626 public immutable erc4626;

  constructor(
    address _protocol,
    address _settings,
    address _redeemPoolFactory,
    address _bribesPoolFactory,
    address _erc4626,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) Vault(_protocol, _settings, _redeemPoolFactory, _bribesPoolFactory, _assetToken_, _pTokenName, _pTokensymbol) {
    require(_erc4626 != address(0), "Zero address detected");
    
    erc4626 = IERC4626(_erc4626);
    IERC20(assetToken).approve(address(erc4626), type(uint256).max);
  }

  function redeemAssetToken() public view override returns (address) {
    return address(erc4626);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _balanceOfUnderlyingVault() internal view override returns (uint256) {
    uint256 shares = erc4626.balanceOf(address(this));
    return erc4626.previewRedeem(shares);
  }

  function _depositToUnderlyingVault(uint256 amount) internal override {
    erc4626.deposit(amount, address(this));
  }

  function _settleRedeemPool(IRedeemPool redeemPool) internal override {
    uint256 ptAmount = redeemPool.totalRedeemingBalance();
    uint256 sharesAmount = 0;
    if (ptAmount > 0) {
      IPToken(pToken).burn(address(redeemPool), ptAmount);
      sharesAmount = erc4626.convertToShares(ptAmount);
      TokensTransfer.transferTokens(address(erc4626), address(this), address(redeemPool), sharesAmount);
    }
    redeemPool.notifySettlement(sharesAmount);
  }

  function _onVaultClose() internal override {
    // do nothing
  }

  function _doUpdateStakingBribes(IBribesPool stakingBribesPool) internal override {
    uint256 principalAssetAmount = IERC20(pToken).totalSupply();
    uint256 principalShares = erc4626.convertToShares(principalAssetAmount);
    uint256 totalShares = erc4626.balanceOf(address(this));

    if (totalShares > principalShares) {
      uint256 yields = totalShares - principalShares;
      IERC20(address(erc4626)).approve(address(stakingBribesPool), yields);
      stakingBribesPool.addBribes(address(erc4626), yields);
    }
  }

  function _redeemOnClose(uint256 ptAmount) internal override {
    uint256 ptTotalSupply = IERC20(pToken).totalSupply();
    uint256 totalShares = erc4626.balanceOf(address(this));
    uint256 shares = ptAmount.mulDiv(totalShares, ptTotalSupply);

    IPToken(pToken).burn(_msgSender(), ptAmount);
    if (shares > 0) {
      TokensTransfer.transferTokens(address(erc4626), address(this), _msgSender(), shares);
    }
  }

}