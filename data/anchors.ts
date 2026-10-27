import type { Policy } from '../src/types.ts';
export const anchors: {slug: string; title: string; region: number; host: number; nightly: number; weekend: number; cleaning: number; policy: Policy; status: string; image: string; instant: number; sleeps: number; bedrooms: number}[] = [
  {slug:'beach-house',title:'Beach House',region:0,host:2,nightly:18000,weekend:22000,cleaning:8000,policy:'flexible',status:'closed',image:'coast',instant:1,sleeps:6,bedrooms:3},
  {slug:'pine-hollow-cabin',title:'Pine Hollow Cabin',region:4,host:3,nightly:13500,weekend:17000,cleaning:6500,policy:'flexible',status:'active',image:'forest',instant:1,sleeps:4,bedrooms:2},
  {slug:'red-rock-casita',title:'Red Rock Casita',region:2,host:4,nightly:12500,weekend:15500,cleaning:5000,policy:'moderate',status:'active',image:'desert',instant:1,sleeps:4,bedrooms:2},
  {slug:'lakeside-a-frame',title:'Lakeside A-Frame',region:6,host:5,nightly:11000,weekend:14000,cleaning:6000,policy:'flexible',status:'active',image:'lake',instant:1,sleeps:4,bedrooms:2},
  {slug:'old-mill-loft',title:'Old Mill Loft',region:8,host:6,nightly:9500,weekend:12500,cleaning:4500,policy:'moderate',status:'active',image:'loft',instant:0,sleeps:2,bedrooms:1},
  {slug:'harbor-point-cottage',title:'Harbor Point Cottage',region:1,host:7,nightly:15500,weekend:19000,cleaning:7000,policy:'strict',status:'active',image:'coast',instant:1,sleeps:5,bedrooms:2},
  {slug:'cedar-ridge-lodge',title:'Cedar Ridge Lodge',region:5,host:1,nightly:21000,weekend:26000,cleaning:10000,policy:'moderate',status:'active',image:'cabin',instant:1,sleeps:8,bedrooms:4},
  {slug:'canyon-view-studio',title:'Canyon View Studio',region:3,host:8,nightly:8500,weekend:11000,cleaning:3500,policy:'flexible',status:'active',image:'desert',instant:0,sleeps:2,bedrooms:0}
];
export const regions = [
 ['dune-meadow','Dune Meadow','Cannon Beach, Oregon',45.891,-123.961,'Salt air, dune trails, and long walks along the Pacific.','coast'],
 ['harbor-point','Harbor Point','Oregon Coast',45.719,-123.944,'Small coves and cottages close to the water.','coast'],
 ['juniper-wash','Juniper Wash','Moab, Utah',38.573,-109.550,'Desert mornings, sandstone, and clear evening skies.','desert'],
 ['copper-canyon','Copper Canyon','Southern Utah',37.283,-112.998,'A quiet base for red rock trails and canyon country.','desert'],
 ['pine-hollow','Pine Hollow','Great Smoky Mountains',35.712,-83.512,'Forest cabins tucked into rolling mountain foothills.','forest'],
 ['cedar-ridge','Cedar Ridge','Blue Ridge Mountains',35.570,-82.497,'Room to gather, with a ridge trail just outside.','cabin'],
 ['silver-bay','Silver Bay','Lake Tahoe, California',38.954,-120.051,'Lakeside mornings and alpine air in every season.','lake'],
 ['fern-shore','Fern Shore','Lake Tahoe, Nevada',39.118,-119.943,'Quiet inlets, pine forests, and a slower rhythm.','lake'],
 ['mill-crossing','Mill Crossing','Hudson Valley, New York',41.892,-74.021,'Brick lofts, orchard lanes, and small-town weekends.','loft'],
 ['orchard-glen','Orchard Glen','Hudson Valley, New York',42.013,-73.899,'Open fields and comfortable homes near the orchards.','meadow'],
 ['spruce-bend','Spruce Bend','Northern Vermont',44.483,-72.712,'Woodland stays and mountain views beyond the porch.','forest'],
 ['moss-creek','Moss Creek','Olympic Peninsula, Washington',48.069,-123.301,'Rainforest walks and cabins with space to slow down.','cabin'],
 ['amber-cove','Amber Cove','Midcoast Maine',44.166,-69.081,'Rocky shores and bright little homes by the bay.','coast'],
 ['willow-field','Willow Field','Shenandoah Valley, Virginia',38.672,-78.487,'Farm roads, rolling hills, and wide-open afternoons.','meadow']
] as const;
