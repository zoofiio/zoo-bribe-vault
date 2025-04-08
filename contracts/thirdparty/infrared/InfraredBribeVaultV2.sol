// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "./interfaces/IInfraredStakingPool.sol";
import "../../vaults/VaultV2.sol";

contract InfraredBribeVaultV2 is VaultV2 {

  IInfraredStakingPool public stakingPool;

  constructor(
    address _protocol,
    address _settings,
    address _redeemPoolFactory,
    address _bribesPoolFactory,
    address _stakingPool_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) VaultV2(_protocol, _settings, _redeemPoolFactory, _bribesPoolFactory, _assetToken_, _pTokenName, _pTokensymbol) {
    require(_stakingPool_ != address(0), "Zero address detected");
    
    stakingPool = IInfraredStakingPool(_stakingPool_);
  }

  function redeemAssetToken() public view override returns (address) {
    return assetToken;
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _balanceOfUnderlyingVault() internal view override returns (uint256) {
    return stakingPool.balanceOf(address(this));
  }

  function _depositToUnderlyingVault(uint256 amount) internal override {
    IERC20(assetToken).approve(address(stakingPool), amount);
    stakingPool.stake(amount);
  }

  function _settleRedeemPool(IRedeemPool redeemPool) internal override {
    uint256 amount = redeemPool.totalRedeemingBalance();
    if (amount > 0) {
      IPTokenV2(pToken).burn(address(redeemPool), amount);
      stakingPool.withdraw(amount);
      TokensTransfer.transferTokens(assetToken, address(this), address(redeemPool), amount);
    }

    redeemPool.notifySettlement(amount);
  }

  function _doUpdateStakingBribes(IBribesPool stakingBribesPool) internal override {
    address[] memory rewardTokens = stakingPool.getAllRewardTokens();
    uint256[] memory prevBalances = new uint256[](rewardTokens.length);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      prevBalances[i] = IERC20(rewardTokens[i]).balanceOf(address(this));
    }

    stakingPool.getReward();

    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      uint256 allBribes = IERC20(bribeToken).balanceOf(address(this)) - prevBalances[i];

      // Add bribes to bribes pool
      if (allBribes > 0) {
        IERC20(bribeToken).approve(address(stakingBribesPool), allBribes);
        stakingBribesPool.addBribes(bribeToken, allBribes);
      }
    }
  }

  function _onVaultClose() internal override {
    if (stakingPool.balanceOf(address(this)) > 0) {
      stakingPool.exit();
    }
  }

  function _redeemOnClose(uint256 ptAmount) internal override {
    IPTokenV2(pToken).burn(_msgSender(), ptAmount);
    TokensTransfer.transferTokens(assetToken, address(this), _msgSender(), ptAmount);
  }

}