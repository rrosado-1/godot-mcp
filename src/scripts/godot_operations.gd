#!/usr/bin/env -S godot --headless --script
extends SceneTree

func _init():
    var args = OS.get_cmdline_args()
    if args.size() < 3:
        printerr("Usage: godot --headless --script godot_operations.gd <operation> <json_params>")
        quit(1)
    
    var operation = args[1]
    var params_json = args[2]
    var params = JSON.parse(params_json).result
    
    if not params:
        printerr("Failed to parse JSON parameters: " + params_json)
        quit(1)
    
    print("Executing operation: " + operation)
    
    match operation:
        "create_scene":
            create_scene(params)
        "add_node":
            add_node(params)
        "load_sprite":
            load_sprite(params)
        "export_mesh_library":
            export_mesh_library(params)
        "save_scene":
            save_scene(params)
        "check_uids":
            check_uids(params)
        "resave_resources":
            resave_resources(params)
        _:
            printerr("Unknown operation: " + operation)
            quit(1)
    
    quit()

# Create a new scene with specified root node type
func create_scene(params):
    print("Creating scene: " + params.scene_path)
    
    # Create the root node
    var root_node_type = params.root_node_type if params.has("root_node_type") else "Node2D"
    
    var root
    match root_node_type:
        "Node2D": root = Node2D.new()
        "Node3D": root = Node3D.new()
        "Control": root = Control.new()
        "Node": root = Node.new()
        _:
            # Try to create the specified type
            var script = GDScript.new()
            script.source_code = "extends SceneTree\nfunc _init():\n\treturn " + root_node_type + ".new()"
            script.reload()
            
            # Try to instantiate the type
            var instance_script = load(script.resource_path)
            if instance_script:
                root = instance_script.new()
            else:
                printerr("Failed to create root node of type: " + root_node_type)
                printerr("Falling back to Node2D")
                root = Node2D.new()
    
    root.name = "root"
    
    # Create a packed scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        # Create directory if it doesn't exist
        var dir = DirAccess.open("res://")
        var scene_dir = params.scene_path.get_base_dir()
        if scene_dir != "" and not dir.dir_exists(scene_dir):
            var error = dir.make_dir_recursive(scene_dir)
            if error != OK:
                printerr("Failed to create directory: " + scene_dir + ", error: " + str(error))
                quit(1)
        
        # Save the scene
        var error = ResourceSaver.save(packed_scene, params.scene_path)
        if error == OK:
            print("Scene created successfully at: " + params.scene_path)
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Add a node to an existing scene
func add_node(params):
    print("Adding node to scene: " + params.scene_path)
    
    # Load the scene
    var scene = load(params.scene_path)
    if not scene:
        printerr("Failed to load scene: " + params.scene_path)
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Find the parent node
    var parent = root
    var parent_path = params.parent_node_path if params.has("parent_node_path") else "root"
    
    if parent_path != "root":
        parent = root.get_node(parent_path.replace("root/", ""))
        if not parent:
            printerr("Parent node not found: " + parent_path)
            quit(1)
    
    # Create the new node
    var new_node
    
    # Try to create the node
    try:
        var script = GDScript.new()
        script.source_code = "extends SceneTree\nfunc _init():\n\treturn " + params.node_type + ".new()"
        script.reload()
        
        # Try to instantiate the type
        var instance_script = load(script.resource_path)
        if instance_script:
            new_node = instance_script.new()
        else:
            printerr("Failed to create node of type: " + params.node_type)
            quit(1)
    except:
        printerr("Failed to create node of type: " + params.node_type)
        printerr("This node type may not exist or may not be instantiable")
        quit(1)
    
    new_node.name = params.node_name
    
    # Set properties if provided
    if params.has("properties"):
        var properties = params.properties
        for property in properties:
            if new_node.get(property) != null:  # Check if property exists
                new_node.set(property, properties[property])
    
    # Add the node to the parent
    parent.add_child(new_node)
    new_node.owner = root
    
    # Save the modified scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        var error = ResourceSaver.save(packed_scene, params.scene_path)
        if error == OK:
            print("Node '" + params.node_name + "' of type '" + params.node_type + "' added successfully")
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Load a sprite into a Sprite2D node
func load_sprite(params):
    print("Loading sprite into scene: " + params.scene_path)
    
    # Load the scene
    var scene = load(params.scene_path)
    if not scene:
        printerr("Failed to load scene: " + params.scene_path)
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Find the sprite node
    var node_path = params.node_path
    if node_path.begins_with("root/"):
        node_path = node_path.substr(5)  # Remove "root/" prefix
    
    var sprite_node = null
    if node_path == "":
        # If no node path, assume root is the sprite
        sprite_node = root
    else:
        sprite_node = root.get_node(node_path)
    
    if not sprite_node:
        printerr("Node not found: " + params.node_path)
        quit(1)
    
    # Check if the node is a Sprite2D or compatible type
    if not (sprite_node is Sprite2D or sprite_node is Sprite3D or sprite_node is TextureRect):
        printerr("Node is not a sprite-compatible type: " + sprite_node.get_class())
        quit(1)
    
    # Load the texture
    var texture = load(params.texture_path)
    if not texture:
        printerr("Failed to load texture: " + params.texture_path)
        quit(1)
    
    # Set the texture on the sprite
    if sprite_node is Sprite2D or sprite_node is Sprite3D:
        sprite_node.texture = texture
    elif sprite_node is TextureRect:
        sprite_node.texture = texture
    
    # Save the modified scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        var error = ResourceSaver.save(packed_scene, params.scene_path)
        if error == OK:
            print("Sprite loaded successfully with texture: " + params.texture_path)
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))

# Export a scene as a MeshLibrary resource
func export_mesh_library(params):
    print("Exporting MeshLibrary from scene: " + params.scene_path)
    
    # Load the scene
    var scene = load(params.scene_path)
    if not scene:
        printerr("Failed to load scene: " + params.scene_path)
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Create a new MeshLibrary
    var mesh_library = MeshLibrary.new()
    
    # Get mesh item names if provided
    var mesh_item_names = params.mesh_item_names if params.has("mesh_item_names") else []
    var use_specific_items = mesh_item_names.size() > 0
    
    # Process all child nodes
    var item_id = 0
    for child in root.get_children():
        # Skip if not using all items and this item is not in the list
        if use_specific_items and not (child.name in mesh_item_names):
            continue
            
        # Check if the child has a mesh
        var mesh_instance = null
        if child is MeshInstance3D:
            mesh_instance = child
        else:
            # Try to find a MeshInstance3D in the child's descendants
            for descendant in child.get_children():
                if descendant is MeshInstance3D:
                    mesh_instance = descendant
                    break
        
        if mesh_instance and mesh_instance.mesh:
            print("Adding mesh: " + child.name)
            
            # Add the mesh to the library
            mesh_library.create_item(item_id)
            mesh_library.set_item_name(item_id, child.name)
            mesh_library.set_item_mesh(item_id, mesh_instance.mesh)
            
            # Add collision shape if available
            for collision_child in child.get_children():
                if collision_child is CollisionShape3D and collision_child.shape:
                    mesh_library.set_item_shapes(item_id, [collision_child.shape])
                    break
            
            # Add preview if available
            if mesh_instance.mesh:
                mesh_library.set_item_preview(item_id, mesh_instance.mesh)
            
            item_id += 1
    
    # Create directory if it doesn't exist
    var dir = DirAccess.open("res://")
    var output_dir = params.output_path.get_base_dir()
    if output_dir != "" and not dir.dir_exists(output_dir):
        var error = dir.make_dir_recursive(output_dir)
        if error != OK:
            printerr("Failed to create directory: " + output_dir + ", error: " + str(error))
            quit(1)
    
    # Save the mesh library
    if item_id > 0:
        var error = ResourceSaver.save(mesh_library, params.output_path)
        if error == OK:
            print("MeshLibrary exported successfully with " + str(item_id) + " items to: " + params.output_path)
        else:
            printerr("Failed to save MeshLibrary: " + str(error))
    else:
        printerr("No valid meshes found in the scene")

# Find files with a specific extension recursively
func find_files(path, extension):
    var files = []
    var dir = DirAccess.open(path)
    
    if dir:
        dir.list_dir_begin()
        var file_name = dir.get_next()
        
        while file_name != "":
            if dir.current_is_dir() and not file_name.begins_with("."):
                files.append_array(find_files(path + file_name + "/", extension))
            elif file_name.ends_with(extension):
                files.append(path + file_name)
            
            file_name = dir.get_next()
    
    return files

# Check UID status for scripts and shaders
func check_uids(params):
    print("Checking UID status for project...")
    
    # Get all .gd and .shader files
    var scripts = find_files("res://", ".gd") + find_files("res://", ".shader") + find_files("res://", ".gdshader")
    print("Found " + str(scripts.size()) + " scripts/shaders")
    
    # Check for missing .uid files
    var missing_uids = []
    var uid_count = 0
    
    for script_path in scripts:
        var uid_path = script_path + ".uid"
        var f = FileAccess.open(uid_path, FileAccess.READ)
        if f:
            uid_count += 1
        else:
            missing_uids.append(script_path)
    
    # Print summary as JSON
    var result = {
        "scriptCount": scripts.size(),
        "uidCount": uid_count,
        "missingCount": missing_uids.size(),
        "missingFiles": missing_uids.slice(0, 10) # Only show first 10 for brevity
    }
    
    print(JSON.stringify(result))

# Resave all resources to update UID references
func resave_resources(params):
    print("Resaving all resources to update UID references...")
    
    # Get all .tscn files
    var scenes = find_files("res://", ".tscn")
    print("Found " + str(scenes.size()) + " scenes")
    
    # Resave each scene
    var success_count = 0
    var error_count = 0
    
    for scene_path in scenes:
        print("Processing: " + scene_path)
        var scene = load(scene_path)
        if scene:
            var error = ResourceSaver.save(scene, scene_path)
            if error == OK:
                success_count += 1
            else:
                error_count += 1
                printerr("Failed to save: " + scene_path + ", error: " + str(error))
        else:
            error_count += 1
            printerr("Failed to load: " + scene_path)
    
    # Get all .gd and .shader files
    var scripts = find_files("res://", ".gd") + find_files("res://", ".shader") + find_files("res://", ".gdshader")
    print("Found " + str(scripts.size()) + " scripts/shaders")
    
    # Check for missing .uid files
    var missing_uids = 0
    for script_path in scripts:
        var uid_path = script_path + ".uid"
        var f = FileAccess.open(uid_path, FileAccess.READ)
        if not f:
            missing_uids += 1
            print("Missing UID file for: " + script_path)
            # Force a save to generate UID
            var res = load(script_path)
            if res:
                ResourceSaver.save(res, script_path)
    
    print("Summary:")
    print("- Scenes processed: " + str(scenes.size()))
    print("- Scenes successfully saved: " + str(success_count))
    print("- Scenes with errors: " + str(error_count))
    print("- Scripts/shaders missing UIDs: " + str(missing_uids))
    print("Resave operation complete")

# Save changes to a scene file
func save_scene(params):
    print("Saving scene: " + params.scene_path)
    
    # Load the scene
    var scene = load(params.scene_path)
    if not scene:
        printerr("Failed to load scene: " + params.scene_path)
        quit(1)
    
    # Instance the scene
    var root = scene.instantiate()
    
    # Determine save path
    var save_path = params.new_path if params.has("new_path") else params.scene_path
    
    # Create directory if it doesn't exist
    if params.has("new_path"):
        var dir = DirAccess.open("res://")
        var scene_dir = save_path.get_base_dir()
        if scene_dir != "" and not dir.dir_exists(scene_dir):
            var error = dir.make_dir_recursive(scene_dir)
            if error != OK:
                printerr("Failed to create directory: " + scene_dir + ", error: " + str(error))
                quit(1)
    
    # Create a packed scene
    var packed_scene = PackedScene.new()
    var result = packed_scene.pack(root)
    if result == OK:
        # Save the scene
        var error = ResourceSaver.save(packed_scene, save_path)
        if error == OK:
            print("Scene saved successfully to: " + save_path)
        else:
            printerr("Failed to save scene: " + str(error))
    else:
        printerr("Failed to pack scene: " + str(result))
