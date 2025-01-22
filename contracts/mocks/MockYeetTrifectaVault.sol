// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract MockYeetTrifectaVault is ERC4626 {
  using SafeERC20 for IERC20;
  using Math for uint256;

  uint256 public immutable _BASIS_POINT_SCALE = 1e4;
  uint256 public exitFeeBasisPoints = 0;

  address public treasury;

  constructor(
    address _asset, string memory _name, string memory _symbol, address _treasury
  ) ERC4626(IERC20(_asset)) ERC20(_name, _symbol) {
    treasury = _treasury;
  }

  function previewWithdraw(uint256 assets) public view override returns (uint256) {
    uint256 fee = _feeOnRaw(assets, exitFeeBasisPoints);
    return super.previewWithdraw(assets + fee);
  }

  function previewRedeem(uint256 shares) public view override returns (uint256) {
    uint256 assets = super.previewRedeem(shares);
    return assets - _feeOnTotal(assets, exitFeeBasisPoints);
  }

  /** @dev See {IERC4626-withdraw}. */
  function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
    require(assets <= maxWithdraw(owner), "ERC4626: withdraw more than max");

    uint256 shares = previewWithdraw(assets);
    _withdraw(_msgSender(), receiver, owner, assets, shares);

    return shares;
  }

  function _withdraw(address caller, address receiver, address assetOwner, uint256 assets, uint256 shares)
    internal override
  {
    if (caller != assetOwner) {
      _spendAllowance(assetOwner, caller, shares);
    }
    uint256 fee = _feeOnRaw(assets, exitFeeBasisPoints);
    _burn(assetOwner, shares);
    // _withdrawFromFarm(assets + fee);
    if (fee > 0) {
      // @todo add event emit
      IERC20(address(asset())).safeTransfer(treasury, fee);
      emit FeeCollected(caller, assetOwner, treasury, fee);
    }
    IERC20(address(asset())).safeTransfer(receiver, assets);
    emit Withdraw(caller, receiver, assetOwner, assets, shares);
  }

  /** @dev See {IERC4626-redeem}. */
  function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256) {
    require(shares <= maxRedeem(owner), "ERC4626: redeem more than max");

    uint256 assets = previewRedeem(shares);
    _withdraw(_msgSender(), receiver, owner, assets, shares);

    return assets;
  }

  /** @dev See {IERC4626-deposit}. */
  function deposit(uint256 assets, address receiver) public virtual override returns (uint256) {
    require(assets <= maxDeposit(receiver), "ERC4626: deposit more than max");

    uint256 shares = previewDeposit(assets);
    _deposit(_msgSender(), receiver, assets, shares);

    return shares;
  }

  function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
    // If _asset is ERC777, `transferFrom` can trigger a reentrancy BEFORE the transfer happens through the
    // `tokensToSend` hook. On the other hand, the `tokenReceived` hook, that is triggered after the transfer,
    // calls the vault, which is assumed not malicious.
    //
    // Conclusion: we need to do the transfer before we mint so that any reentrancy would happen before the
    // assets are transferred and before the shares are minted, which is a valid state.
    // slither-disable-next-line reentrancy-no-eth
    IERC20(address(asset())).safeTransferFrom(caller, address(this), assets);
    // deposit into Beradrome farm
    // _depositIntoFarm(assets); // slightly dilutes unclaimed rewards. Can be used to frontrun rewards
    _mint(receiver, shares);

    emit Deposit(caller, receiver, assets, shares);
  }

  /// @dev Calculates the fees that should be added to an amount `assets` that does not already include fees.
  /// Used in {IERC4626-mint} and {IERC4626-withdraw} operations.
  function _feeOnRaw(uint256 assets, uint256 feeBasisPoints) private pure returns (uint256) {
    return assets.mulDiv(feeBasisPoints, _BASIS_POINT_SCALE, Math.Rounding.Up);
  }

  /// @dev Calculates the fee part of an amount `assets` that already includes fees.
  /// Used in {IERC4626-deposit} and {IERC4626-redeem} operations.
  function _feeOnTotal(uint256 assets, uint256 feeBasisPoints) private pure returns (uint256) {
    return assets.mulDiv(feeBasisPoints, feeBasisPoints + _BASIS_POINT_SCALE, Math.Rounding.Up);
  }

  function _decimalsOffset() internal pure override returns (uint8) {
    return 5;
  }

  event FeeCollected(address indexed caller, address indexed assetOwner, address indexed treasury, uint256 fee);

}