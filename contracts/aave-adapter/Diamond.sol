// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { LibDiamond } from "./libraries/LibDiamond.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract Diamond is ReentrancyGuardTransient {
    constructor(address _contractOwner) {
        LibDiamond.setContractOwner(_contractOwner);
    }

    function diamondCut(LibDiamond.FacetCut[] calldata _diamondCut) external {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.diamondCut(_diamondCut);
    }

    fallback() external payable {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();

        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "Diamond: Function does not exist");

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {}
}
