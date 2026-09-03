const supabaseService = require('../services/supabaseService');

class CourseMaterialController {
  // Get materials for a class
  async getMaterials(req, res) {
    try {
      const { classId } = req.params;

      const { data: materials, error } = await supabaseService.client
        .from('course_materials')
        .select('*')
        .eq('class_id', classId)
        .eq('is_published', true)
        .order('order_index', { ascending: true });

      if (error) throw error;

      res.json(materials);
    } catch (error) {
      console.error('Get materials error:', error);
      res.status(500).json({ error: 'Failed to fetch materials' });
    }
  }

  // Get material by ID
  async getMaterial(req, res) {
    try {
      const { materialId } = req.params;

      const { data: material, error } = await supabaseService.client
        .from('course_materials')
        .select('*')
        .eq('id', materialId)
        .single();

      if (error) throw error;

      if (!material) {
        return res.status(404).json({ error: 'Material not found' });
      }

      res.json(material);
    } catch (error) {
      console.error('Get material error:', error);
      res.status(500).json({ error: 'Failed to fetch material' });
    }
  }

  // Create material (staff/admin)
  async createMaterial(req, res) {
    try {
      const data = req.body;

      const { data: material, error } = await supabaseService.client
        .from('course_materials')
        .insert([{
          ...data,
          is_published: data.is_published || false,
          published_at: data.is_published ? new Date().toISOString() : null
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Material created successfully',
        material
      });
    } catch (error) {
      console.error('Create material error:', error);
      res.status(500).json({ error: 'Failed to create material' });
    }
  }

  // Update material
  async updateMaterial(req, res) {
    try {
      const { materialId } = req.params;
      const updates = req.body;

      if (updates.is_published && !updates.published_at) {
        updates.published_at = new Date().toISOString();
      }

      const { data: material, error } = await supabaseService.client
        .from('course_materials')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', materialId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Material updated successfully',
        material
      });
    } catch (error) {
      console.error('Update material error:', error);
      res.status(500).json({ error: 'Failed to update material' });
    }
  }

  // Delete material
  async deleteMaterial(req, res) {
    try {
      const { materialId } = req.params;

      await supabaseService.client
        .from('course_materials')
        .delete()
        .eq('id', materialId);

      res.json({ message: 'Material deleted successfully' });
    } catch (error) {
      console.error('Delete material error:', error);
      res.status(500).json({ error: 'Failed to delete material' });
    }
  }
}

module.exports = new CourseMaterialController();